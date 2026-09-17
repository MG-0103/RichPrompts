"""LLM verifier for extraction candidates.

Given a regex-detected candidate (paragraph + proposed target of
tool/skill/schema) and the current registry of tool/skill names,
classify:
  - extract : yes, this is a self-contained procedure/schema/trigger
              that would work better as a separate reusable component
  - reject  : no — it's describing existing behavior, meta-language,
              general constraint, role/personality prose, or references
              an already-registered tool/skill

The rejection reason is surfaced so users can see why the regex fired
falsely. Uses the same gpt-4o-mini pattern as the duplication verifier
in verify.py; ~230 tokens per call.
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
MAX_CANDIDATES = 64
MAX_CHARS_PER_TEXT = 4000
REQUEST_TIMEOUT_S = 30.0
CONCURRENCY = 4

ExtractDecision = Literal["extract", "reject"]
VALID_DECISIONS: set[str] = {"extract", "reject"}

SYSTEM_PROMPT = (
    "You decide whether a paragraph from a system prompt should be "
    "extracted into a separate reusable component (a tool, a skill, or "
    "a structured output schema). Extract only if the paragraph is a "
    "self-contained procedure, schema, or trigger-plus-behavior block "
    "that would work better OUTSIDE the prompt.\n\n"
    "Reject if any of:\n"
    "- The paragraph references or describes how to USE an already-"
    "  existing tool or skill (it's documentation of the existing "
    "  component, not a new extractable one).\n"
    "- The paragraph is meta-language about the agent's behavior "
    "  (\"the agent should…\", \"you will…\", \"your task is to…\").\n"
    "- The paragraph is part of role/persona/personality definition.\n"
    "- The paragraph is a general constraint that applies broadly, not "
    "  a discrete procedure.\n"
    "- The paragraph is describing outputs, response style, or tone "
    "  without a concrete schema.\n\n"
    "Extract only if it's a genuinely new, extractable, reusable piece.\n\n"
    "Output JSON: {\"decision\": \"extract\"|\"reject\", "
    "\"reason\": \"<one short sentence>\"}"
)


class VerifyExtractError(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(text: str, target: str, tools: tuple[str, ...], skills: tuple[str, ...], model: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update(target.encode("utf-8"))
    h.update(b"\0")
    for t in sorted(tools):
        h.update(t.encode("utf-8"))
        h.update(b"\t")
    h.update(b"\0")
    for s in sorted(skills):
        h.update(s.encode("utf-8"))
        h.update(b"\t")
    h.update(b"\0")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


class ExtractVerifyCache:
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


CACHE = ExtractVerifyCache()


async def _classify_candidate(
    client: httpx.AsyncClient,
    text: str,
    target: str,
    reason: str,
    tools: list[str],
    skills: list[str],
    model: str,
    api_key: str,
) -> dict:
    user_msg = (
        f"Existing tool names in the registry: {', '.join(tools) or '(none)'}\n"
        f"Existing skill names in the registry: {', '.join(skills) or '(none)'}\n\n"
        f"Paragraph:\n{text[:MAX_CHARS_PER_TEXT]}\n\n"
        f"Proposed extraction target: {target}\n"
        f"Regex reasoning: {reason[:400]}"
    )
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
                {"role": "user", "content": user_msg},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
            "max_tokens": 120,
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    if resp.status_code != 200:
        raise VerifyExtractError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise VerifyExtractError(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {"decision": "reject", "reason": "(non-JSON response — treated as reject)"}
    raw = str(parsed.get("decision", "reject")).strip().lower()
    decision = raw if raw in VALID_DECISIONS else "reject"
    reason_out = str(parsed.get("reason", ""))[:240]
    return {"decision": cast(ExtractDecision, decision), "reason": reason_out}


async def verify_extractions(
    candidates: list[dict],  # each: {text, target, reason}
    tools: list[str],
    skills: list[str],
    model: str | None = None,
) -> tuple[list[dict], int]:
    """Classify each candidate. Returns (verdicts_in_input_order, cached_count)."""
    if not candidates:
        return [], 0
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"extraction verifier unavailable: {reason}")

    model_name = model or DEFAULT_MODEL
    api_key = os.environ["OPENAI_API_KEY"]

    tools_t = tuple(sorted(set(tools)))
    skills_t = tuple(sorted(set(skills)))

    keys = [
        _cache_key(c["text"], c["target"], tools_t, skills_t, model_name)
        for c in candidates
    ]
    results: list[dict | None] = [None] * len(candidates)
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
                    c = candidates[idx]
                    verdict = await _classify_candidate(
                        client,
                        c["text"],
                        c["target"],
                        c.get("reason", ""),
                        list(tools_t),
                        list(skills_t),
                        model_name,
                        api_key,
                    )
                    results[idx] = verdict
                    CACHE.put(keys[idx], verdict)

            await asyncio.gather(*(worker(i) for i in misses))

    out: list[dict] = []
    for i, v in enumerate(results):
        if v is None:
            raise VerifyExtractError(f"internal: missing verdict at index {i}")
        out.append(v)
    return out, cached
