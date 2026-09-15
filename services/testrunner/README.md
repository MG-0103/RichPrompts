# RichPrompt Test Runner

Python sidecar for the RichPrompt linter. Runs test cases against the
current in-memory registry (prompt + tools + skills) and reports
routing-quality metrics per test.

**Phase 10 (current):** mock runner only — deterministic, no LLM calls,
no ADK. Wires up the whole request/response contract so the web UI can
be built and shipped independently of Phase 11's real agent integration.

## Run (dev)

```
cd services/testrunner
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --port 8787 --reload
```

The web app expects the sidecar on `http://localhost:8787` (override via
`VITE_TESTRUNNER_URL`).

## Endpoints

- `GET /health` → `{ok, version, mode}`
- `POST /run` → runs all test cases and returns per-test metrics.

Request shape matches `TestRunRequest` in
`packages/core/src/testing.ts`; response matches `TestRunResponse`.

## Phase 11 preview

The real runner will replace `mock_runner.py` with an ADK-based one:

- Build a `google.adk.Agent` from the prompt (system prompt), tools
  (function tools with stub callables), and skills (tool-like entries).
- Loop N rollouts at the configured temperature, capture the tool call,
  argument shape, latency, trajectory-step count, and — where the model
  exposes it — the `avg_logprobs` on the selected tool.
- Everything else in this repo (schemas, HTTP surface, web UI) stays
  unchanged.
