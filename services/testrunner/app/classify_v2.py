"""Hierarchical section classifier for v2 Phase 2.

Given a text chunk (from Phase 1's segmenter or from a regex-derived
section), returns which canonical section it belongs to, with a
confidence and top-3 alternatives.

Design notes:

  * Ships with an LLM backend (gpt-4o-mini) as the MVP. This is
    strictly cheaper to build than shipping a fine-tuned NLI model
    with the sidecar (transformers + torch is 300MB+ of deps we
    don't want unless the classification quality demands it).
  * If the LLM backend fails Phase 2's gate (≥ 80% family / ≥ 65%
    leaf), swap in a DeBERTa-v3-base-mnli NLI backend — the response
    shape is designed to accommodate either.

Cost: ~200 tokens per call × ($0.15 in + $0.60 out per M) ≈ $0.0002
per chunk. For a typical prompt with 6 chunks that's $0.0012 — same
order as the section-classifier from v1, and cheaper than
`/verify` (which is pair-wise).
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
MAX_CHARS = 8000
REQUEST_TIMEOUT_S = 30.0

# The canonical taxonomy. Kept in the classifier so the prompt is
# self-contained; must stay in sync with packages/core/src/types.ts
# CanonicalSection.
FAMILY_LABELS = ["textual", "tool", "skill", "agent"]
TEXTUAL_LABELS = [
    "role", "persona", "style", "tone",
    "task", "context",
    "output", "input",
    "constraints", "reasoning", "examples", "guardrails",
]

SYSTEM_PROMPT = (
    "You classify chunks of a system prompt into canonical section "
    "labels. Two levels of classification:\n\n"
    "LEVEL 1 — the family. Pick exactly ONE:\n"
    "- textual: written prose instructions (role, task, output, "
    "constraints, tone, style, examples, reasoning directives, "
    "guardrails, context, input).\n"
    "- tool: a tool definition (name + description + schema).\n"
    "- skill: a skill/plugin definition (when-to-use + workflow).\n"
    "- agent: a delegation section describing a sub-agent.\n\n"
    "LEVEL 2 — the specific label (only when family = textual). Pick "
    "exactly ONE:\n"
    "- role: who the model is or acts as (the job description).\n"
    "- persona: a specific fictional identity (a named character or "
    "distinctive personality).\n"
    "- style: HOW the model writes — sentence length, formality, "
    "structure preferences.\n"
    "- tone: the register or mood (friendly, terse, formal).\n"
    "- task: what the model is being asked to DO.\n"
    "- context: background information the model should know.\n"
    "- output: the shape or format of the response.\n"
    "- input: where the user's input goes / how it's formatted.\n"
    "- constraints: hard rules the model must follow.\n"
    "- reasoning: chain-of-thought / thinking directives.\n"
    "- examples: few-shot demonstrations.\n"
    "- guardrails: refusal rules / safety-critical constraints.\n\n"
    "When family is tool/skill/agent, the label is that same family "
    "name (leaf = family for these). When family is textual, produce "
    "the specific level-2 label.\n\n"
    "CRITICAL DISTINCTIONS — these are the confusion cases from "
    "eval:\n"
    "* A section INSIDE a skill file (a 'When to use' block, a "
    "'Workflow' step list, a Constraints list) is TEXTUAL, not "
    "family=skill. Family=skill means the CHUNK ITSELF is a raw "
    "skill definition (frontmatter + description). 'When to use' → "
    "family=textual, label=task. 'Workflow' → family=textual, "
    "label=task.\n"
    "* An Output section that CONTAINS a JSON schema block is still "
    "family=textual, label=output. Family=tool only when the CHUNK "
    "ITSELF is a raw tool definition (name + description + input "
    "schema fields at top level). A prose description of expected "
    "output shape, even with a code fence, is output.\n"
    "* An Agents section that starts with orchestration prose "
    "(before the sub-agent definitions) is family=textual with "
    "label=agents. Do NOT call it context — context is background "
    "info about the domain, not about the model's sub-agents. "
    "family=agent is reserved for the DEFINITION of ONE sub-agent.\n"
    "* A Workflow section that describes ORDERED delegation between "
    "sub-agents (step 1: delegate to X, step 2: delegate to Y) is "
    "still family=textual, label=task. It's the ORCHESTRATION "
    "instruction to the model, not a sub-agent definition.\n"
    "* 'Identity' and 'Persona' headings almost always classify as "
    "persona (fictional identity). 'Role' headings classify as role "
    "(job description). Ambiguity between the two is genuine and "
    "should show up in the confidence.\n\n"
    "Return exactly this JSON, no prose:\n"
    "{"
    '\"family\": \"textual|tool|skill|agent\", '
    '\"label\": \"one of the labels above\", '
    '\"confidence\": 0.0-1.0, '
    '\"alternatives\": ['
    '  {\"label\": \"...\", \"confidence\": 0.0-1.0}, '
    '  {\"label\": \"...\", \"confidence\": 0.0-1.0}'
    '], '
    '\"reasoning\": \"one short sentence naming the strongest signal\"'
    "}\n"
    "CONFIDENCE CALIBRATION: your confidence distribution must "
    "reflect real uncertainty, not the default urge to sound "
    "certain. Guide:\n"
    "* Textbook case (only one label fits): top=0.90–0.95, "
    "alternatives ≈ 0.05\n"
    "* Reasonable but not perfect fit: top=0.70–0.85, top alt=0.10–0.25\n"
    "* Two labels really do apply: top=0.50–0.65, top alt=0.30–0.45 "
    "(gap ≤ 0.25 — the ambiguity signal downstream cares about)\n"
    "Do not force 0.90+ for the ambiguous cases just because they're "
    "asking you to pick one. The ambiguous flag is USEFUL — it "
    "routes hard cases to a human. Suppressing it hurts the pipeline."
)


class ClassifyV2Error(Exception):
    pass


def is_available() -> tuple[bool, str | None]:
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(text: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


class ClassifyV2Cache:
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


CACHE = ClassifyV2Cache()

# Confidence gap below which we mark the chunk as ambiguous. First
# eval showed 0/113 flagged at 0.10 — gpt-4o-mini almost always emits
# top confidence ≥ 0.85 for a decisive answer and 0.60–0.70 for the
# genuinely uncertain ones, with runner-up ~0.10–0.30. Real ambiguous
# cases sit in the 0.15–0.30 gap band, so 0.25 catches them without
# false-flagging the confident majority.
AMBIGUOUS_GAP = 0.25


def _normalize(parsed: dict) -> dict:
    """Coerce the LLM's parsed JSON into the response schema. Ensures
    label is valid, confidence is in [0, 1], top-2 alternatives are
    present (padded if needed), and `ambiguous` is derived from the
    confidence gap."""
    family = str(parsed.get("family", "textual")).lower()
    if family not in FAMILY_LABELS:
        family = "textual"
    label = str(parsed.get("label", "task")).lower()
    if family == "textual":
        if label not in TEXTUAL_LABELS:
            label = "task"
    else:
        label = family
    try:
        confidence = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))
    raw_alts = parsed.get("alternatives", [])
    alts: list[dict] = []
    for a in raw_alts:
        if not isinstance(a, dict):
            continue
        l = str(a.get("label", "")).lower()
        if not l:
            continue
        try:
            c = float(a.get("confidence", 0.0))
        except (TypeError, ValueError):
            c = 0.0
        c = max(0.0, min(1.0, c))
        alts.append({"label": l, "confidence": c})
    while len(alts) < 2:
        alts.append({"label": "", "confidence": 0.0})
    alts = alts[:2]
    top_alt_conf = alts[0]["confidence"] if alts else 0.0
    ambiguous = (confidence - top_alt_conf) < AMBIGUOUS_GAP
    reasoning = str(parsed.get("reasoning", ""))[:200]
    return {
        "family": family,
        "label": label,
        "confidence": confidence,
        "alternatives": alts,
        "ambiguous": ambiguous,
        "reasoning": reasoning,
    }


async def classify_chunk(
    text: str,
    model: str | None = None,
) -> tuple[dict, bool]:
    """Return ({family, label, confidence, alternatives, ambiguous,
    reasoning}, cached_hit).
    """
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"classifier unavailable: {reason}")

    trimmed = text[:MAX_CHARS]
    model_name = model or DEFAULT_MODEL
    key = _cache_key(trimmed, model_name)
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
                    {"role": "user", "content": trimmed},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.0,
                "max_tokens": 250,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
    if resp.status_code != 200:
        raise ClassifyV2Error(f"OpenAI {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise ClassifyV2Error(f"unexpected OpenAI response shape: {str(data)[:300]}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        raise ClassifyV2Error(f"non-JSON classify response: {content[:300]}")

    result = _normalize(parsed)
    CACHE.put(key, result)
    return cast(dict, result), False
