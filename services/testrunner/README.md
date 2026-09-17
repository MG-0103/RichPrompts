# RichPrompt Test Runner

Python sidecar for the RichPrompt linter. Runs test cases against the
current in-memory registry (prompt + tools + skills) and reports
routing-quality metrics per test.

**Phase 11 (current):** two modes.
- `mock` — deterministic, no LLM calls. Default. Always available.
- `real` — one rollout per test against Gemini via `google-genai`.
  `temperature=0`, no logprobs yet.

Phase 12+ will add multi-rollout sampling, real logprob capture (or a
reranking-probe alternative), and lift into `google.adk.agents.LlmAgent`
for trajectory events.

## Run (mock only)

```
cd services/testrunner
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --port 8787 --reload
```

## Run (with real Gemini routing)

```
pip install -e '.[genai]'
export GOOGLE_API_KEY=…            # get one at https://aistudio.google.com/
uvicorn app.main:app --port 8787 --reload
```

`GET /health` reports which modes are available:

```
{ "ok": true, "version": "0.2.0", "mode": "real+mock",
  "real": {"available": true, "reason": null} }
```

## Endpoints

- `GET /health` → `{ok, version, mode, real, openai, cache}`
- `POST /run` → runs the test cases. Body: `TestRunRequest` (see
  `packages/core/src/testing.ts`). Set `config.mock=false` to use the
  real runner; the sidecar returns HTTP 503 if it isn't ready
  (missing API key, missing dep) so the UI can surface a real error
  rather than silently falling back.
- `POST /embed` → returns OpenAI embeddings for a batch of texts.
  Body: `{texts: string[], model?: string}`. Response:
  `{vectors, cachedCount, model, durationMs}`. Model defaults to
  `text-embedding-3-small`. Requires `OPENAI_API_KEY` in the
  environment. 502 on OpenAI failures, 503 when the key isn't set,
  413 on batches over 512 texts or per-text length over 16k chars.
  Server-side cache keyed by sha256(text + model); response reports
  cache hits.

## Model selection

Defaults to `gemini-2.5-flash`. Override per-request via
`config.model` (any Gemini model your API key can access).
