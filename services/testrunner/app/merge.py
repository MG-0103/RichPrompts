"""LLM merger for duplication clusters.

Given N near-duplicate paragraphs from a system prompt, returns ONE
merged paragraph that keeps the union of unique instructions from all
inputs, drops redundant restatements, and uses whichever phrasing is
clearest. Called from /merge-cluster to power the "propose merge" flow
in the Duplication view.

Cost: ~350 tokens per call × 1 call per cluster × ($0.15 in + $0.60 out
per M) ≈ $0.001 per merge. Cached by (sorted member texts, model).
"""

from __future__ import annotations

import hashlib
import json
import os
from threading import Lock
from typing import cast

import httpx

DEFAULT_MODEL = "gpt-4o-mini"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
MAX_MEMBERS = 12
MAX_CHARS_PER_MEMBER = 4000
REQUEST_TIMEOUT_S = 30.0

SYSTEM_PROMPT = (
    "You merge near-duplicate paragraphs from a system prompt into ONE "
    "paragraph. The inputs are separate paragraphs from the SAME prompt "
    "that a linter flagged as saying the same thing.\n\n"
    "Your merge must:\n"
    "1. Keep every unique instruction, constraint, or fact from any input.\n"
    "2. Drop restatements — if two inputs say the same rule, keep it once.\n"
    "3. Use whichever wording is clearest and most specific.\n"
    "4. Preserve the tone (imperative → imperative, declarative → "
    "declarative). Do not editorialize.\n"
    "5. Return a paragraph, not a bulleted list, unless every input was "
    "a list.\n\n"
    "Output exactly this JSON, no prose:\n"
    '{"merged": "the merged paragraph", "reason": "one sentence on '
    'what was consolidated or dropped"}'
)


class MergeError(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(members: list[str], model: str) -> str:
    # Order-independent hash — same cluster, same key regardless of
    # which order the caller passed the members in.
    canon = sorted(m.strip() for m in members)
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    for m in canon:
        h.update(b"\0")
        h.update(m.encode("utf-8"))
    return h.hexdigest()


class MergeCache:
    def __init__(self, max_entries: int = 512):
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


CACHE = MergeCache()


async def merge_cluster(
    members: list[str],
    model: str | None = None,
) -> tuple[dict, bool]:
    """Return ({merged, reason}, cached_hit)."""
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"merger unavailable: {reason}")

    trimmed = [m[:MAX_CHARS_PER_MEMBER] for m in members]
    model_name = model or DEFAULT_MODEL
    key = _cache_key(trimmed, model_name)
    hit = CACHE.get(key)
    if hit is not None:
        return hit, True

    api_key = os.environ["OPENAI_API_KEY"]
    numbered = "\n\n".join(f"[{i + 1}]\n{m}" for i, m in enumerate(trimmed))
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            OPENAI_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": numbered},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.0,
                "max_tokens": 600,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
    if resp.status_code != 200:
        raise MergeError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise MergeError(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        raise MergeError(f"non-JSON merge response: {content[:300]}")

    merged = str(parsed.get("merged", "")).strip()
    reason = str(parsed.get("reason", ""))[:400]
    if not merged:
        raise MergeError("empty merged paragraph in response")
    result = {"merged": merged, "reason": reason}
    CACHE.put(key, result)
    return cast(dict, result), False
