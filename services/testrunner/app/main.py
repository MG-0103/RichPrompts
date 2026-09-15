import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .mock_runner import run_mock
from .schemas import TestRunRequest, TestRunResponse

SIDECAR_VERSION = "0.1.0-mock"

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
    return {"ok": True, "version": SIDECAR_VERSION, "mode": "mock"}


@app.post("/run", response_model=TestRunResponse)
def run(req: TestRunRequest) -> TestRunResponse:
    return run_mock(req)
