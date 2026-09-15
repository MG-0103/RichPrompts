import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .cache import CACHE, key_for
from .mock_runner import run_mock
from .real_runner import is_available as real_available, run_real
from .schemas import (
    RegistryEntry,
    TestCase,
    TestResult,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
)
from .strip import strip_entries

SIDECAR_VERSION = "0.4.0"

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
    real_ok, reason = real_available()
    return {
        "ok": True,
        "version": SIDECAR_VERSION,
        "mode": "real+mock" if real_ok else "mock",
        "real": {"available": real_ok, "reason": reason},
        "cache": {"size": CACHE.size()},
    }


@app.delete("/cache")
def clear_cache() -> dict:
    return {"cleared": CACHE.clear()}


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
