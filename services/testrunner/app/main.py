import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .cache import CACHE, key_for
from .embed import (
    CACHE as EMBED_CACHE,
    DEFAULT_MODEL as DEFAULT_EMBED_MODEL,
    EmbedError,
    embed_batch,
    is_available as embed_available,
    MAX_BATCH as EMBED_MAX_BATCH,
    MAX_CHARS_PER_TEXT as EMBED_MAX_CHARS,
)
from .verify import (
    CACHE as VERIFY_CACHE,
    DEFAULT_MODEL as DEFAULT_VERIFY_MODEL,
    MAX_PAIRS as VERIFY_MAX_PAIRS,
    MAX_CHARS_PER_TEXT as VERIFY_MAX_CHARS,
    VerifyError,
    is_available as verify_available,
    verify_pairs,
)
from .mock_runner import run_mock
from .real_runner import is_available as real_available, run_real
from .schemas import (
    EmbedRequest,
    EmbedResponse,
    RegistryEntry,
    TestCase,
    TestResult,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
    VerifyRequest,
    VerifyResponse,
    VerifyVerdict,
)
from .strip import strip_entries

SIDECAR_VERSION = "0.6.0"

app = FastAPI(title="RichPrompt Test Runner", version=SIDECAR_VERSION)

origins = os.environ.get("TESTRUNNER_CORS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["POST", "GET", "OPTIONS", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    real_ok, real_reason = real_available()
    embed_ok, embed_reason = embed_available()
    verify_ok, verify_reason = verify_available()
    return {
        "ok": True,
        "version": SIDECAR_VERSION,
        "mode": "real+mock" if real_ok else "mock",
        "real": {"available": real_ok, "reason": real_reason},
        # openai path covers both embeddings and verifier (same key).
        "openai": {"available": embed_ok, "reason": embed_reason},
        "verifier": {"available": verify_ok, "reason": verify_reason},
        "cache": {
            "size": CACHE.size(),
            "embed": EMBED_CACHE.size(),
            "verify": VERIFY_CACHE.size(),
        },
    }


@app.delete("/cache")
def clear_cache() -> dict:
    return {
        "cleared": CACHE.clear(),
        "embed_cleared": EMBED_CACHE.clear(),
        "verify_cleared": VERIFY_CACHE.clear(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    if len(req.texts) == 0:
        return EmbedResponse(vectors=[], cachedCount=0, model=req.model or DEFAULT_EMBED_MODEL, durationMs=0.0)
    if len(req.texts) > EMBED_MAX_BATCH * 4:
        raise HTTPException(
            status_code=413,
            detail=f"too many texts in one call: {len(req.texts)} > {EMBED_MAX_BATCH * 4}",
        )
    for i, t in enumerate(req.texts):
        if not isinstance(t, str):
            raise HTTPException(status_code=422, detail=f"texts[{i}] is not a string")
    for i, t in enumerate(req.texts):
        if len(t) > EMBED_MAX_CHARS * 2:
            # Server-side truncate happens in embed_batch; if it's WAY over
            # the caller likely made a mistake — reject rather than silently
            # truncating a 40k-char blob.
            raise HTTPException(
                status_code=413,
                detail=f"texts[{i}] length {len(t)} exceeds {EMBED_MAX_CHARS * 2}",
            )
    ready, reason = embed_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"embeddings unavailable: {reason}")

    started = time.perf_counter()
    try:
        vectors, cached_count = await embed_batch(req.texts, req.model)
    except EmbedError as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return EmbedResponse(
        vectors=vectors,
        cachedCount=cached_count,
        model=req.model or DEFAULT_EMBED_MODEL,
        durationMs=duration,
    )


@app.post("/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest) -> VerifyResponse:
    if len(req.pairs) == 0:
        return VerifyResponse(
            verdicts=[],
            cachedCount=0,
            model=req.model or DEFAULT_VERIFY_MODEL,
            durationMs=0.0,
        )
    if len(req.pairs) > VERIFY_MAX_PAIRS:
        raise HTTPException(
            status_code=413,
            detail=f"too many pairs in one call: {len(req.pairs)} > {VERIFY_MAX_PAIRS}",
        )
    for i, p in enumerate(req.pairs):
        if len(p.a) > VERIFY_MAX_CHARS * 2 or len(p.b) > VERIFY_MAX_CHARS * 2:
            raise HTTPException(
                status_code=413,
                detail=f"pairs[{i}] text exceeds {VERIFY_MAX_CHARS * 2}",
            )
    ready, reason = verify_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"verifier unavailable: {reason}")

    started = time.perf_counter()
    try:
        raw, cached_count = await verify_pairs(
            [(p.a, p.b) for p in req.pairs],
            req.model,
        )
    except VerifyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return VerifyResponse(
        verdicts=[VerifyVerdict(**v) for v in raw],
        cachedCount=cached_count,
        model=req.model or DEFAULT_VERIFY_MODEL,
        durationMs=duration,
    )


def _run_pass(
    prompt: str,
    tools: list[RegistryEntry],
    skills: list[RegistryEntry],
    tests: list[TestCase],
    config: TestRunConfig,
    stripped: bool,
) -> list[TestResult]:
    """Compute results for one pass (full or stripped), using the cache
    for any test whose key already has a result."""
    hits: dict[str, TestResult] = {}
    misses: list[tuple[str, TestCase]] = []
    for tc in tests:
        k = key_for(prompt, tools, skills, tc, config, stripped=stripped)
        hit = CACHE.get(k)
        if hit is not None:
            hits[tc.id] = hit
        else:
            misses.append((k, tc))

    fresh: dict[str, TestResult] = {}
    if misses:
        miss_tests = [m[1] for m in misses]
        sub = TestRunRequest(
            prompt=prompt, tools=tools, skills=skills,
            testCases=miss_tests, config=config,
        )
        if config.mock:
            resp = run_mock(sub, stripped=stripped)
        else:
            ok, reason = real_available()
            if not ok:
                raise HTTPException(status_code=503, detail=f"real runner unavailable: {reason}")
            # Real runner reads raw text — description stripping already
            # happened at the RegistryEntry level in this function's
            # caller, so `run_real` just gets what it should see.
            resp = run_real(sub)
        for r in resp.results:
            fresh[r.testId] = r
        for k, tc in misses:
            r = fresh.get(tc.id)
            if r is not None:
                CACHE.put(k, r)

    ordered: list[TestResult] = []
    for tc in tests:
        if tc.id in hits:
            ordered.append(hits[tc.id])
        elif tc.id in fresh:
            ordered.append(fresh[tc.id])
    return ordered


@app.post("/run", response_model=TestRunResponse)
def run(req: TestRunRequest) -> TestRunResponse:
    started = time.perf_counter()
    config = req.config or TestRunConfig()

    full_results = _run_pass(
        req.prompt, req.tools, req.skills, req.testCases, config, stripped=False,
    )

    if config.ablation:
        stripped_tools = strip_entries(req.tools, "tool")
        stripped_skills = strip_entries(req.skills, "skill")
        stripped_results = _run_pass(
            req.prompt, stripped_tools, stripped_skills, req.testCases, config,
            stripped=True,
        )
        by_id = {r.testId: r for r in stripped_results}
        full_results = [
            r.model_copy(update={"stripped": by_id.get(r.testId)}) for r in full_results
        ]

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=full_results,
        durationMs=duration,
        sidecarVersion=SIDECAR_VERSION,
    )
