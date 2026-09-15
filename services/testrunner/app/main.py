import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .mock_runner import run_mock
from .real_runner import is_available as real_available, run_real
from .schemas import TestRunRequest, TestRunResponse

SIDECAR_VERSION = "0.2.0"

app = FastAPI(title="RichPrompt Test Runner", version=SIDECAR_VERSION)

origins = os.environ.get("TESTRUNNER_CORS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["POST", "GET", "OPTIONS"],
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
    }


@app.post("/run", response_model=TestRunResponse)
def run(req: TestRunRequest) -> TestRunResponse:
    # Explicit mock=True (or no explicit config) → mock. Explicit mock=False
    # → real, and we hard-error if it isn't ready so the UI gets a clear
    # message instead of a silent fallback.
    prefer_mock = req.config is None or req.config.mock
    if prefer_mock:
        return run_mock(req)
    ready, reason = real_available()
    if not ready:
        raise HTTPException(status_code=503, detail=f"real runner unavailable: {reason}")
    return run_real(req)
