"""Thin wrapper around the Anthropic Messages API.

Isolates the SDK usage so analyzers, judges, and the case generator can
share the same client, timeout, and JSON-parsing conventions.

Defaults picked from the claude-api skill:

- `claude-opus-5` as the default model
- adaptive thinking on
- streaming with `.get_final_message()` for anything that may run long
- structured JSON returned by prompting the model to produce a specific
  schema, then parsing with `json.loads` — we deliberately do NOT use
  `messages.parse()` here because the analyzer's output schema evolves
  more often than the SDK's tool-parsing helpers can conveniently track.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import anthropic


DEFAULT_MODEL = "claude-opus-5"


@dataclass
class LlmSettings:
    model: str = DEFAULT_MODEL
    max_tokens: int = 16_000
    effort: str = "high"  # low | medium | high | xhigh | max


def get_client() -> anthropic.Anthropic:
    """Return a cached Anthropic client.

    The zero-arg constructor picks up credentials from `ANTHROPIC_API_KEY`,
    `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile — no key needs
    to be hardcoded.
    """
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


_client: anthropic.Anthropic | None = None


def call_json(
    *,
    system: str | list[dict[str, Any]],
    user: str,
    settings: LlmSettings | None = None,
) -> dict[str, Any]:
    """Call Claude with `system`+`user`, expect a JSON object back.

    `system` accepts either a plain string or a list of text blocks. Use
    the list form when you want to attach `cache_control` to a specific
    block — e.g. a large stable docs block that should be cached across
    per-agent calls.

    We stream the request and use `.get_final_message()` — with
    `max_tokens` at 16k on a reasoning-heavy call this keeps us well
    under the SDK's HTTP timeout even if the model thinks for a while.
    """
    settings = settings or LlmSettings()
    client = get_client()

    with client.messages.stream(
        model=settings.model,
        max_tokens=settings.max_tokens,
        thinking={"type": "adaptive"},
        output_config={"effort": settings.effort},
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        message = stream.get_final_message()

    # Concatenate every text block; strip any accidental prose around the JSON.
    text = "".join(
        block.text for block in message.content if block.type == "text"
    ).strip()

    return _extract_json_object(text)


def _extract_json_object(text: str) -> dict[str, Any]:
    """Best-effort extract of the JSON object in a model response.

    Handles: raw JSON, JSON in a ```json fenced block, JSON with a small
    preamble. Falls back to raising with the original text attached so the
    caller can log it.
    """
    # 1. ```json fenced block
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if m:
        return json.loads(m.group(1))
    # 2. bare ``` fenced block
    m = re.search(r"```\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if m:
        return json.loads(m.group(1))
    # 3. first {...} span
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError(f"Model did not return a JSON object. Raw text:\n{text}")
