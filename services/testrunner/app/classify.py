"""LLM section classifier for prompt docs.

Given the full source of a prompt, classifies which of the four canonical
sections (role / task / output / constraints) are *conceptually* present,
regardless of whether they appear under a labelled heading or the regex
classifier caught them. Used as a tier-2 fallback for `missing-sections`
when the regex tier misses paraphrase-shaped openings like
"As an expert…", "The goal here is…", "Please always follow these
rules…".

One call per doc, cached by (doc_hash, model). Cost per audit is
< $0.001 with gpt-4o-mini — the whole doc fits in one request even for
long prompts (we truncate at ~12k chars just to be safe).
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
MAX_CHARS = 12000
REQUEST_TIMEOUT_S = 30.0

CanonicalSection = str  # "role" | "task" | "output" | "constraints"
VALID_SECTIONS: set[str] = {"role", "task", "output", "constraints"}

SYSTEM_PROMPT = (
    "You judge which of four canonical sections are conceptually present "
    "in a system prompt for an LLM. Sections:\n"
    "- role: who the model is or acts as (persona, identity).\n"
    "- task: what the model is being asked to do (objective, job).\n"
    "- output: the shape or format of the response.\n"
    "- constraints: rules, restrictions, or requirements it must obey.\n\n"
    "A section counts as present if the substance is there, even without "
    "a labelled heading. Do NOT require literal words. Examples that "
    "count as present:\n"
    "- 'As an expert code reviewer…' → role present.\n"
    "- 'The goal here is to summarize the article' → task present.\n"
    "- 'Please always cite sources and never fabricate.' → constraints "
    "present.\n"
    "- 'Return JSON with fields x, y, z.' → output present.\n\n"
    "Output exactly this JSON, no prose:\n"
    '{"role": bool, "task": bool, "output": bool, "constraints": bool, '
    '"reasoning": "one short sentence per present section, comma-separated"}'
)


class ClassifyError(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(source: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update(source.encode("utf-8"))
    return h.hexdigest()


class ClassifyCache:
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


CACHE = ClassifyCache()


async def classify_sections(
    source: str,
    model: str | None = None,
) -> tuple[dict, bool]:
    """Return ({found: [...], reasoning: str}, cached_hit)."""
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"classifier unavailable: {reason}")

    model_name = model or DEFAULT_MODEL
    text = source[:MAX_CHARS]
    key = _cache_key(text, model_name)
    hit = CACHE.get(key)
    if hit is not None:
        return hit, True

    api_key = os.environ["OPENAI_API_KEY"]
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
                    {"role": "user", "content": text},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.0,
                "max_tokens": 200,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
    if resp.status_code != 200:
        raise ClassifyError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise ClassifyError(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        raise ClassifyError(f"non-JSON classifier response: {content[:300]}")

    found: list[str] = []
    for k in ("role", "task", "output", "constraints"):
        if bool(parsed.get(k, False)):
            found.append(k)
    reasoning = str(parsed.get("reasoning", ""))[:400]
    result = {"found": found, "reasoning": reasoning}
    CACHE.put(key, result)
    return cast(dict, result), False
