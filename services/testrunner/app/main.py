import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .cache import CACHE, key_for
from .mock_runner import run_mock
from .real_runner import is_available as real_available, run_real
from .schemas import TestRunConfig, TestRunRequest, TestRunResponse

SIDECAR_VERSION = "0.3.0"

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


@app.post("/run", response_model=TestRunResponse)
def run(req: TestRunRequest) -> TestRunResponse:
    started = time.perf_counter()
    config = req.config or TestRunConfig()

    # Split cases into cache-hits and cache-misses.
    hits = {}
    misses = []
    for tc in req.testCases:
        k = key_for(req.prompt, req.tools, req.skills, tc, config)
        hit = CACHE.get(k)
        if hit is not None:
            hits[tc.id] = hit
        else:
            misses.append((k, tc))

    fresh_results = []
    if misses:
        sub = req.model_copy(update={"testCases": [m[1] for m in misses]})
        prefer_mock = config.mock
        if prefer_mock:
            resp = run_mock(sub)
        else:
            ok, reason = real_available()
            if not ok:
                raise HTTPException(status_code=503, detail=f"real runner unavailable: {reason}")
            resp = run_real(sub)
        # Cache each freshly-computed result.
        by_id = {r.testId: r for r in resp.results}
        for k, tc in misses:
            r = by_id.get(tc.id)
            if r is not None:
                CACHE.put(k, r)
        fresh_results = resp.results

    # Reassemble in the original order.
    ordered = []
    fresh_by_id = {r.testId: r for r in fresh_results}
    for tc in req.testCases:
        if tc.id in hits:
            ordered.append(hits[tc.id])
        elif tc.id in fresh_by_id:
            ordered.append(fresh_by_id[tc.id])

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=ordered,
        durationMs=duration,
        sidecarVersion=SIDECAR_VERSION,
    )
