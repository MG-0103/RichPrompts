"""Phase 12 runner: N rollouts per test against a real Gemini model.

Builds `google.genai` `FunctionDeclaration`s from tool JSON and skill
frontmatter, then samples N rollouts at the configured temperature
in parallel via a thread pool. Aggregation (pass rate, concentration,
composite score) is shared with the mock runner in `aggregate.py`.

Gemini doesn't expose logprobs on function-call responses yet, so
confidence comes from the empirical modal-choice distribution
(concentration). Phase 12.x may add a separate reranking probe to
recover a proper logprob-shaped signal; for now, concentration is the
signal.

Phase 12.y planned lift into `google.adk.agents.LlmAgent` for
first-class trajectory events. This file is the only one that
should need to change.
"""

from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .aggregate import aggregate
from .schemas import (
    CalledTarget,
    RolloutOutcome,
    TestCase,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
)

try:
    from google import genai
    from google.genai import types as gtypes

    GENAI_AVAILABLE = True
except ImportError:  # pragma: no cover
    GENAI_AVAILABLE = False


def is_available() -> tuple[bool, str | None]:
    if not GENAI_AVAILABLE:
        return False, "google-genai not installed (pip install '.[genai]')"
    if not os.environ.get("GOOGLE_API_KEY"):
        return False, "GOOGLE_API_KEY not set"
    return True, None


# ---------- Declaration builders ---------------------------------------


def _tool_to_decl(raw_json: str):
    try:
        t = json.loads(raw_json)
    except Exception:
        return None
    name = t.get("name")
    if not name:
        return None
    desc = t.get("description") or ""
    params = t.get("parameters") or t.get("input_schema")
    return gtypes.FunctionDeclaration(
        name=name,
        description=desc,
        parameters=_sanitize_schema(params) if params else None,
    )


_SKILL_NAME_SAN = re.compile(r"[^a-zA-Z0-9_]")


def _skill_to_decl(raw_md: str, fallback_id: str):
    fm_match = re.match(r"^---\s*\n([\s\S]*?)\n---", raw_md)
    if not fm_match:
        return None
    fm = fm_match.group(1)
    name_m = re.search(r"^name:\s*(.+)$", fm, re.M)
    desc_m = re.search(r"^description:\s*([\s\S]*?)(?:\n[a-zA-Z_-]+:|\Z)", fm, re.M)
    raw_name = (name_m.group(1) if name_m else fallback_id).strip()
    name = _SKILL_NAME_SAN.sub("_", raw_name).strip("_")
    if not name:
        return None
    desc = (desc_m.group(1).strip() if desc_m else "").strip()
    return gtypes.FunctionDeclaration(
        name=name,
        description=desc,
        parameters={"type": "OBJECT", "properties": {}},
    )


def _sanitize_schema(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return schema
    out = {}
    for k, v in schema.items():
        if k == "type" and isinstance(v, str):
            out[k] = v.upper()
        elif k == "properties" and isinstance(v, dict):
            out[k] = {pk: _sanitize_schema(pv) for pk, pv in v.items()}
        elif k == "items":
            out[k] = _sanitize_schema(v)
        else:
            out[k] = v
    return out


# ---------- One rollout ------------------------------------------------


def _extract_call(
    resp: Any, tool_names: set[str], skill_names: set[str]
) -> CalledTarget:
    candidates = getattr(resp, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            fc = getattr(part, "function_call", None)
            if fc and getattr(fc, "name", None):
                if fc.name in skill_names:
                    return CalledTarget(kind="skill", name=fc.name)
                # Fall through: unknown names are recorded as `tool` for
                # debugging (aggregate.judge_pass will still mark them as
                # failing against the expected target).
                return CalledTarget(kind="tool", name=fc.name)
    return CalledTarget(kind="none")


def _count_steps(resp: Any) -> int:
    candidates = getattr(resp, "candidates", None) or []
    n = 0
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        n += len(parts)
    return max(1, n)


def _run_one(
    client: Any,
    model: str,
    system_instruction: str,
    tc: TestCase,
    tools: Any,
    tool_names: set[str],
    skill_names: set[str],
    temperature: float,
) -> RolloutOutcome:
    started = time.perf_counter()
    try:
        resp = client.models.generate_content(
            model=model,
            contents=tc.query,
            config=gtypes.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=tools if tools else None,
                temperature=temperature,
            ),
        )
        latency = (time.perf_counter() - started) * 1000
        return RolloutOutcome(
            called=_extract_call(resp, tool_names, skill_names),
            latencyMs=latency,
            steps=_count_steps(resp),
            logprob=None,
        )
    except Exception as e:
        latency = (time.perf_counter() - started) * 1000
        return RolloutOutcome(
            called=None,
            latencyMs=latency,
            steps=0,
            error=f"{type(e).__name__}: {e}",
        )


# ---------- Batch of rollouts for one test ----------------------------


def _run_test(
    client: Any,
    model: str,
    prompt: str,
    tc: TestCase,
    tools: Any,
    tool_names: set[str],
    skill_names: set[str],
    rollouts_n: int,
    temperature: float,
) -> list[RolloutOutcome]:
    """N parallel rollouts. Sequential fallback if the pool is too small."""
    outs: list[RolloutOutcome] = []
    with ThreadPoolExecutor(max_workers=min(rollouts_n, 8)) as pool:
        futures = [
            pool.submit(
                _run_one, client, model, prompt, tc, tools,
                tool_names, skill_names, temperature,
            )
            for _ in range(rollouts_n)
        ]
        for f in as_completed(futures):
            outs.append(f.result())
    return outs


# ---------- Public entry -----------------------------------------------


def run_real(req: TestRunRequest) -> TestRunResponse:
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"real runner unavailable: {reason}")

    config = req.config or TestRunConfig()
    model = config.model or "gemini-2.5-flash"
    rollouts_n = max(1, config.rollouts)
    temperature = config.temperature

    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    tool_names: set[str] = set()
    skill_names: set[str] = set()
    decls: list[Any] = []
    for t in req.tools:
        d = _tool_to_decl(t.raw)
        if d is not None:
            decls.append(d)
            tool_names.add(d.name)
    for s in req.skills:
        d = _skill_to_decl(s.raw, s.id)
        if d is not None:
            decls.append(d)
            skill_names.add(d.name)
    tools = [gtypes.Tool(function_declarations=decls)] if decls else None

    started = time.perf_counter()
    results = []
    for tc in req.testCases:
        outcomes = _run_test(
            client, model, req.prompt, tc, tools,
            tool_names, skill_names, rollouts_n, temperature,
        )
        results.append(aggregate(tc, outcomes, mock=False))

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=results,
        durationMs=duration,
        sidecarVersion=f"0.3.0-genai-{model}",
    )
