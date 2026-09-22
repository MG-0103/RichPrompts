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
from .verify_extract import (
    CACHE as VERIFY_EXTRACT_CACHE,
    DEFAULT_MODEL as DEFAULT_VERIFY_EXTRACT_MODEL,
    MAX_CANDIDATES as VERIFY_EXTRACT_MAX,
    MAX_CHARS_PER_TEXT as VERIFY_EXTRACT_MAX_CHARS,
    VerifyExtractError,
    is_available as verify_extract_available,
    verify_extractions,
)
from .classify import (
    CACHE as CLASSIFY_CACHE,
    DEFAULT_MODEL as DEFAULT_CLASSIFY_MODEL,
    MAX_CHARS as CLASSIFY_MAX_CHARS,
    ClassifyError,
    classify_sections,
    is_available as classify_available,
)
from .merge import (
    CACHE as MERGE_CACHE,
    DEFAULT_MODEL as DEFAULT_MERGE_MODEL,
    MAX_MEMBERS as MERGE_MAX_MEMBERS,
    MAX_CHARS_PER_MEMBER as MERGE_MAX_CHARS,
    MergeError,
    merge_cluster,
    is_available as merge_available,
)
from .segment import (
    DEFAULT_THRESHOLD as SEGMENT_DEFAULT_THRESHOLD,
    DEFAULT_MIN_GAP_CHARS as SEGMENT_DEFAULT_MIN_GAP,
    segment as segment_source,
)
from .classify_v2 import (
    CACHE as CLASSIFY_V2_CACHE,
    DEFAULT_MODEL as DEFAULT_CLASSIFY_V2_MODEL,
    ClassifyV2Error,
    classify_chunk,
    is_available as classify_v2_available,
)
from .mock_runner import run_mock
from .real_runner import is_available as real_available, run_real
from .schemas import (
    ClassifySectionsRequest,
    ClassifySectionsResponse,
    MergeClusterRequest,
    MergeClusterResponse,
    SegmentDebugPayload,
    SegmentPairSimilarity,
    SegmentRequest,
    SegmentResponse,
    ClassifyV2Request,
    ClassifyV2Response,
    ClassifyAlternative,
    EmbedRequest,
    EmbedResponse,
    ExtractionVerdict,
    RegistryEntry,
    TestCase,
    TestResult,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
    VerifyExtractionRequest,
    VerifyExtractionResponse,
    VerifyRequest,
    VerifyResponse,
    VerifyVerdict,
)
from .strip import strip_entries

SIDECAR_VERSION = "0.7.0"

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
    verify_extract_ok, verify_extract_reason = verify_extract_available()
    classify_ok, classify_reason = classify_available()
    merge_ok, merge_reason = merge_available()
    return {
        "ok": True,
        "version": SIDECAR_VERSION,
        "mode": "real+mock" if real_ok else "mock",
        "real": {"available": real_ok, "reason": real_reason},
        # openai path covers both embeddings and verifier (same key).
        "openai": {"available": embed_ok, "reason": embed_reason},
        "verifier": {"available": verify_ok, "reason": verify_reason},
        "extractionVerifier": {"available": verify_extract_ok, "reason": verify_extract_reason},
        "sectionClassifier": {"available": classify_ok, "reason": classify_reason},
        "clusterMerger": {"available": merge_ok, "reason": merge_reason},
        "cache": {
            "size": CACHE.size(),
            "embed": EMBED_CACHE.size(),
            "verify": VERIFY_CACHE.size(),
            "verifyExtract": VERIFY_EXTRACT_CACHE.size(),
            "classify": CLASSIFY_CACHE.size(),
            "merge": MERGE_CACHE.size(),
        },
    }


@app.delete("/cache")
def clear_cache() -> dict:
    return {
        "cleared": CACHE.clear(),
        "embed_cleared": EMBED_CACHE.clear(),
        "verify_cleared": VERIFY_CACHE.clear(),
        "verify_extract_cleared": VERIFY_EXTRACT_CACHE.clear(),
        "classify_cleared": CLASSIFY_CACHE.clear(),
        "merge_cleared": MERGE_CACHE.clear(),
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


@app.post("/verify-extraction", response_model=VerifyExtractionResponse)
async def verify_extraction(req: VerifyExtractionRequest) -> VerifyExtractionResponse:
    if len(req.candidates) == 0:
        return VerifyExtractionResponse(
            verdicts=[],
            cachedCount=0,
            model=req.model or DEFAULT_VERIFY_EXTRACT_MODEL,
            durationMs=0.0,
        )
    if len(req.candidates) > VERIFY_EXTRACT_MAX:
        raise HTTPException(
            status_code=413,
            detail=f"too many candidates in one call: {len(req.candidates)} > {VERIFY_EXTRACT_MAX}",
        )
    for i, c in enumerate(req.candidates):
        if len(c.text) > VERIFY_EXTRACT_MAX_CHARS * 2:
            raise HTTPException(
                status_code=413,
                detail=f"candidates[{i}] text exceeds {VERIFY_EXTRACT_MAX_CHARS * 2}",
            )
    ready, reason = verify_extract_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"extraction verifier unavailable: {reason}")

    started = time.perf_counter()
    try:
        raw, cached_count = await verify_extractions(
            [{"text": c.text, "target": c.target, "reason": c.reason} for c in req.candidates],
            req.toolNames,
            req.skillNames,
            req.model,
        )
    except VerifyExtractError as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return VerifyExtractionResponse(
        verdicts=[ExtractionVerdict(**v) for v in raw],
        cachedCount=cached_count,
        model=req.model or DEFAULT_VERIFY_EXTRACT_MODEL,
        durationMs=duration,
    )


@app.post("/classify-sections", response_model=ClassifySectionsResponse)
async def classify_sections_endpoint(
    req: ClassifySectionsRequest,
) -> ClassifySectionsResponse:
    if not req.source.strip():
        return ClassifySectionsResponse(
            found=[],
            reasoning="",
            cached=False,
            model=req.model or DEFAULT_CLASSIFY_MODEL,
            durationMs=0.0,
        )
    # No hard reject on size — the classifier truncates internally to
    # MAX_CHARS (32k) and the LLM easily handles the rest. Reject only
    # payloads that would obviously waste bandwidth (1 MB+).
    if len(req.source) > 1_000_000:
        raise HTTPException(
            status_code=413,
            detail=f"source exceeds 1,000,000 chars — split the document first",
        )
    ready, reason = classify_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"section classifier unavailable: {reason}")

    started = time.perf_counter()
    try:
        result, cached = await classify_sections(req.source, req.model)
    except ClassifyError as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return ClassifySectionsResponse(
        found=result["found"],
        reasoning=result["reasoning"],
        cached=cached,
        model=req.model or DEFAULT_CLASSIFY_MODEL,
        durationMs=duration,
        truncatedFrom=int(result.get("truncatedFrom", 0)),
    )


@app.post("/merge-cluster", response_model=MergeClusterResponse)
async def merge_cluster_endpoint(req: MergeClusterRequest) -> MergeClusterResponse:
    if len(req.members) < 2:
        raise HTTPException(status_code=400, detail="need at least 2 members to merge")
    if len(req.members) > MERGE_MAX_MEMBERS:
        raise HTTPException(
            status_code=413,
            detail=f"too many members: {len(req.members)} > {MERGE_MAX_MEMBERS}",
        )
    for i, m in enumerate(req.members):
        if len(m) > MERGE_MAX_CHARS * 2:
            raise HTTPException(
                status_code=413,
                detail=f"members[{i}] exceeds {MERGE_MAX_CHARS * 2}",
            )
    ready, reason = merge_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"merger unavailable: {reason}")

    started = time.perf_counter()
    try:
        result, cached = await merge_cluster(req.members, req.model)
    except MergeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return MergeClusterResponse(
        merged=result["merged"],
        reason=result["reason"],
        cached=cached,
        model=req.model or DEFAULT_MERGE_MODEL,
        durationMs=duration,
        refused=bool(result.get("refused", False)),
    )


@app.post("/v2/segment", response_model=SegmentResponse)
async def v2_segment(req: SegmentRequest) -> SegmentResponse:
    """v2 Phase 1 — semantic chunking of unheaded regions."""
    if not req.source.strip():
        return SegmentResponse(
            boundaries=[],
            thresholdUsed=req.threshold or SEGMENT_DEFAULT_THRESHOLD,
            model="",
            durationMs=0.0,
            debug=SegmentDebugPayload(sentenceOffsets=[], pairSimilarities=[], gapRegions=[]),
        )
    if len(req.source) > 200_000:
        raise HTTPException(status_code=413, detail="source exceeds 200,000 chars")
    ready, reason = embed_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"segment unavailable: {reason}")

    started = time.perf_counter()
    threshold = req.threshold if req.threshold is not None else SEGMENT_DEFAULT_THRESHOLD
    min_gap = req.minGapChars if req.minGapChars is not None else SEGMENT_DEFAULT_MIN_GAP
    boundaries, debug = await segment_source(
        req.source,
        req.knownBoundaries,
        threshold=threshold,
        min_gap_chars=min_gap,
        model=req.model,
    )
    duration = (time.perf_counter() - started) * 1000
    return SegmentResponse(
        boundaries=boundaries,
        thresholdUsed=threshold,
        model=req.model or DEFAULT_EMBED_MODEL,
        durationMs=duration,
        debug=SegmentDebugPayload(
            sentenceOffsets=[list(t) for t in debug.sentence_offsets],
            pairSimilarities=[
                SegmentPairSimilarity(
                    gap=p["gap"],
                    leftRange=list(p["left_range"]),
                    rightRange=list(p["right_range"]),
                    similarity=p["similarity"],
                )
                for p in debug.pair_similarities
            ],
            gapRegions=[list(t) for t in debug.gap_regions],
        ),
    )


@app.post("/v2/classify", response_model=ClassifyV2Response)
async def v2_classify(req: ClassifyV2Request) -> ClassifyV2Response:
    """v2 Phase 2 — hierarchical section classifier."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="empty text")
    if len(req.text) > 100_000:
        raise HTTPException(status_code=413, detail="text exceeds 100,000 chars")
    ready, reason = classify_v2_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"classifier unavailable: {reason}")

    started = time.perf_counter()
    try:
        result, cached = await classify_chunk(req.text, req.model)
    except ClassifyV2Error as e:
        raise HTTPException(status_code=502, detail=str(e))
    duration = (time.perf_counter() - started) * 1000
    return ClassifyV2Response(
        family=result["family"],
        label=result["label"],
        confidence=result["confidence"],
        alternatives=[ClassifyAlternative(**a) for a in result["alternatives"]],
        ambiguous=result["ambiguous"],
        reasoning=result["reasoning"],
        cached=cached,
        model=req.model or DEFAULT_CLASSIFY_V2_MODEL,
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
