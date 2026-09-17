"""LLM verifier for paragraph-pair relationships.

Uses OpenAI Chat Completions (gpt-4o-mini by default) with strict
JSON output to classify each pair as one of:
  - duplicate      : express the same instruction, different words
  - contradictory  : state conflicting instructions
  - related        : same topic, distinct content
  - unrelated      : different topics

Called from /verify to precision-filter semantic duplication clusters.
The contradiction label is a *free* new finding — no additional cost,
just a different label surfaced separately in the UI.

Batching: OpenAI Chat Completions has no native batch mode for
independent classifications, so we fan out with a bounded semaphore.
For a typical audit that's ~10-30 pairs; parallelism of 4 keeps
wall time under a couple of seconds.

Cost math (85k prompt, ~15 candidate pairs post-embeddings):
  ~230 tokens per call × 15 calls × ($0.15 input + $0.60 output per M)
  ≈ $0.001 per audit. Effectively free.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from threading import Lock
from typing import Literal, cast

import httpx

DEFAULT_MODEL = "gpt-4o-mini"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
MAX_PAIRS = 128
MAX_CHARS_PER_TEXT = 4000
REQUEST_TIMEOUT_S = 30.0
CONCURRENCY = 4

VerifyLabel = Literal["duplicate", "contradictory", "related", "unrelated"]
VALID_LABELS: set[str] = {"duplicate", "contradictory", "related", "unrelated"}

SYSTEM_PROMPT = (
    "You classify relationships between paragraphs from a system prompt "
    "used by an LLM agent. Given two paragraphs A and B, output JSON:\n"
    '{"label": "...", "reason": "..."}\n'
    "where label is exactly one of:\n"
    "- duplicate: A and B express the same instruction or constraint, "
    "just worded differently.\n"
    "- contradictory: A and B state conflicting instructions or "
    "constraints. Read carefully — subtle 'always vs never' style "
    "conflicts count.\n"
    "- related: A and B address the same topic but state distinct "
    "things (not the same rule; not opposites).\n"
    "- unrelated: A and B are about different topics.\n"
    "reason: one short sentence, under 20 words, naming the specific "
    "shared or conflicting element."
)


class VerifyError(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(a: str, b: str, model: str) -> str:
    # Order-independent: (A,B) and (B,A) hash the same
    left, right = (a, b) if a <= b else (b, a)
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update(left.encode("utf-8"))
    h.update(b"\0")
    h.update(right.encode("utf-8"))
    return h.hexdigest()


class VerifyCache:
    def __init__(self, max_entries: int = 4096):
        self._store: dict[str, dict] = {}
        self._lock = Lock()
        self._max = max_entries

    def get(self, key: str) -> dict | None:
        with self._lock:
            return self._store.get(key)

    def put(self, key: str, value: dict) -> None:
        with self._lock:
            if len(self._store) >= self._max:
                self._store.pop(next(iter(self._store)))
            self._store[key] = value

    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def clear(self) -> int:
        with self._lock:
            n = len(self._store)
            self._store.clear()
            return n


CACHE = VerifyCache()


async def _classify_pair(
    client: httpx.AsyncClient,
    a: str,
    b: str,
    model: str,
    api_key: str,
) -> dict:
    resp = await client.post(
        OPENAI_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"A:\n{a[:MAX_CHARS_PER_TEXT]}\n\nB:\n{b[:MAX_CHARS_PER_TEXT]}",
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
            "max_tokens": 120,
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    if resp.status_code != 200:
        raise VerifyError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise VerifyError(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        # Model returned free-form despite json_object mode — recover gracefully.
        return {"label": "unrelated", "reason": "(non-JSON response — treated as unrelated)"}
    raw_label = str(parsed.get("label", "unrelated")).strip().lower()
    label = raw_label if raw_label in VALID_LABELS else "unrelated"
    reason = str(parsed.get("reason", ""))[:200]
    return {"label": cast(VerifyLabel, label), "reason": reason}


async def verify_pairs(
    pairs: list[tuple[str, str]],
    model: str | None = None,
) -> tuple[list[dict], int]:
    """Classify each (a, b) pair. Returns (labels_in_input_order, cached_count)."""
    if not pairs:
        return [], 0
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"verifier unavailable: {reason}")

    model_name = model or DEFAULT_MODEL
    api_key = os.environ["OPENAI_API_KEY"]

    keys = [_cache_key(a, b, model_name) for a, b in pairs]
    results: list[dict | None] = [None] * len(pairs)
    misses: list[int] = []
    cached = 0
    for i, k in enumerate(keys):
        hit = CACHE.get(k)
        if hit is not None:
            results[i] = hit
            cached += 1
        else:
            misses.append(i)

    if misses:
        sem = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient() as client:
            async def worker(idx: int) -> None:
                async with sem:
                    a, b = pairs[idx]
                    verdict = await _classify_pair(client, a, b, model_name, api_key)
                    results[idx] = verdict
                    CACHE.put(keys[idx], verdict)

            await asyncio.gather(*(worker(i) for i in misses))

    out: list[dict] = []
    for i, v in enumerate(results):
        if v is None:
            raise VerifyError(f"internal: missing verdict at index {i}")
        out.append(v)
    return out, cached
