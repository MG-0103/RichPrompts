"""LLM atomizer — v2 Phase 3.

Decomposes a paragraph into atomic instructions. An atom is a single
self-contained rule / statement / fact. Compound sentences with 'and'
split into distinct atoms unless the two halves genuinely depend on
each other (a conditional stays as one atom).

Design decisions:

  * The LLM returns each atom's TEXT as a verbatim substring of the
    input paragraph. This lets us compute exact offsets on the server
    side via string search — LLMs are unreliable at emitting exact
    character positions but reliable at emitting substrings. Any atom
    that doesn't match verbatim gets dropped with a warning in the
    debug payload.
  * Atom `kind` is metadata (imperative / declarative / conditional /
    example). Helps downstream classifiers (contradiction detection
    prefers imperative-vs-imperative comparisons).
  * Section label is optional context — an atomizer that knows the
    surrounding section (constraints, output, etc.) makes better
    calls on edge cases.

Cost: ~300 tokens/call × ($0.15 in + $0.60 out per M) ≈ $0.0003 per
paragraph. Twelve-paragraph prompt ≈ $0.004 per audit.
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
MAX_CHARS_PER_PARAGRAPH = 8000
REQUEST_TIMEOUT_S = 30.0

ATOM_KINDS = {"imperative", "declarative", "conditional", "example"}

SYSTEM_PROMPT = (
    "You decompose a paragraph from a system prompt into atomic "
    "instructions. Each atom is one self-contained rule or fact. "
    "Split compound sentences unless the halves depend on each other.\n\n"
    "Rules for splitting:\n\n"
    "1. 'A and B' where A and B are independent rules → two atoms.\n"
    "   Example input: 'Always cite sources and never fabricate.'\n"
    "   → atoms: ['Always cite sources', 'never fabricate']\n\n"
    "2. Conditionals stay as ONE atom. Do not split condition from "
    "action.\n"
    "   Example input: 'If the user asks a question, respond in JSON.'\n"
    "   → atoms: ['If the user asks a question, respond in JSON']\n\n"
    "3. Bullet lists: each bullet is its own atom.\n"
    "   Example input: '- Cite sources.\\n- Use active voice.'\n"
    "   → atoms: ['Cite sources', 'Use active voice']\n\n"
    "4. Examples embedded in instructions stay with the parent atom.\n"
    "   Example input: 'Be concise (e.g., under 100 words).'\n"
    "   → atoms: ['Be concise (e.g., under 100 words)']\n\n"
    "5. Negation stays with the atom it modifies — don't split 'do X "
    "and don't do Y' where they're the same action polarity.\n"
    "   Example input: 'Do not use emojis and do not use bullets.'\n"
    "   → atoms: ['Do not use emojis', 'do not use bullets']\n\n"
    "Kinds:\n"
    "- imperative: a rule / instruction / command\n"
    "- declarative: a statement of fact\n"
    "- conditional: an if/when/unless rule (single atom preserving "
    "the condition)\n"
    "- example: a demonstration or few-shot sample\n\n"
    "CRITICAL: Each atom's `text` MUST be a VERBATIM substring of the "
    "input paragraph. Do not paraphrase. Do not add or remove words. "
    "Do not fix typos. This is how we compute atom offsets in the "
    "source. If you can't produce a verbatim substring for an atom, "
    "leave it out.\n\n"
    "Return exactly this JSON, no prose:\n"
    "{\n"
    '  "atoms": [\n'
    '    {"text": "verbatim substring", "kind": "imperative"},\n'
    '    ...\n'
    "  ]\n"
    "}\n"
)


class AtomizeError(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(text: str, section: str | None, model: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update((section or "").encode("utf-8"))
    h.update(b"\0")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


class AtomizeCache:
    def __init__(self, max_entries: int = 2048):
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


CACHE = AtomizeCache()


def resolve_offsets(
    paragraph: str,
    atoms: list[dict],
) -> tuple[list[dict], list[str]]:
    """For each atom, find its position in `paragraph` via string
    search. Walks through the paragraph left-to-right, so an atom
    that appears at position P must appear AFTER the previous
    matched atom. Any atom whose text isn't verbatim in the source
    (or appears before the last matched position) is dropped.

    Returns (resolved_atoms, warnings).
    """
    out: list[dict] = []
    warnings: list[str] = []
    cursor = 0
    for i, atom in enumerate(atoms):
        text = str(atom.get("text", "")).strip()
        if not text:
            warnings.append(f"atom[{i}]: empty text")
            continue
        idx = paragraph.find(text, cursor)
        if idx < 0:
            # Try from the start in case the LLM emitted atoms
            # out-of-order (rare but possible).
            idx = paragraph.find(text)
            if idx < 0:
                warnings.append(
                    f"atom[{i}] not a verbatim substring: "
                    f"{text[:80]!r}"
                )
                continue
        kind = str(atom.get("kind", "imperative")).lower()
        if kind not in ATOM_KINDS:
            kind = "imperative"
        out.append({
            "text": text,
            "kind": kind,
            "startOffset": idx,
            "endOffset": idx + len(text),
        })
        cursor = idx + len(text)
    return out, warnings


async def atomize_paragraph(
    paragraph: str,
    section: str | None = None,
    model: str | None = None,
) -> tuple[dict, bool]:
    """Return ({atoms, warnings}, cached_hit)."""
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"atomizer unavailable: {reason}")

    trimmed = paragraph[:MAX_CHARS_PER_PARAGRAPH]
    model_name = model or DEFAULT_MODEL
    key = _cache_key(trimmed, section, model_name)
    hit = CACHE.get(key)
    if hit is not None:
        return hit, True

    api_key = os.environ["OPENAI_API_KEY"]
    user_content = trimmed
    if section:
        user_content = f"Section: {section}\n\nParagraph:\n{trimmed}"
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
                    {"role": "user", "content": user_content},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.0,
                "max_tokens": 600,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
    if resp.status_code != 200:
        raise AtomizeError(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise AtomizeError(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        raise AtomizeError(f"non-JSON atomizer response: {content[:300]}")

    raw_atoms = parsed.get("atoms", [])
    if not isinstance(raw_atoms, list):
        raise AtomizeError(f"atoms not a list: {type(raw_atoms).__name__}")
    resolved, warnings = resolve_offsets(trimmed, raw_atoms)
    result = {"atoms": resolved, "warnings": warnings}
    CACHE.put(key, result)
    return cast(dict, result), False
