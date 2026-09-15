"""Phase 11 runner: single rollout per test against a real Gemini model.

Builds a `google.genai` `FunctionDeclaration` per tool JSON and per skill
frontmatter description. Sends the query with the prompt as
system_instruction and the declarations as tools. Captures the
resulting function call (or lack of one), latency, and a step-count
proxy.

Kept intentionally small: one call per test, `temperature=0`, no
logprobs plumbing yet. Phase 12 will add N-rollouts, temperature > 0
sampling, and (where the Gemini API exposes it) `avg_logprobs` on the
selected tool. Phase 12.x will lift this into a `google.adk.agents.LlmAgent`
so we get trajectory events for free.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from .schemas import (
    CalledTarget,
    RolloutOutcome,
    TestCase,
    TestResult,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
)

try:  # optional dep — mock runner works without it
    from google import genai
    from google.genai import types as gtypes

    GENAI_AVAILABLE = True
except ImportError:  # pragma: no cover
    GENAI_AVAILABLE = False


def is_available() -> tuple[bool, str | None]:
    """Return (ready, reason_if_not)."""
    if not GENAI_AVAILABLE:
        return False, "google-genai not installed (pip install '.[genai]')"
    if not os.environ.get("GOOGLE_API_KEY"):
        return False, "GOOGLE_API_KEY not set"
    return True, None


# ---------- Declaration builders ---------------------------------------


def _tool_to_decl(raw_json: str) -> "gtypes.FunctionDeclaration | None":
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


def _skill_to_decl(raw_md: str, fallback_id: str) -> "gtypes.FunctionDeclaration | None":
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
    """Gemini's schema wants uppercased primitive types and drops unsupported
    JSON-Schema keys silently. We do a light pass to be defensive."""
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


# ---------- Rollout ----------------------------------------------------


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
                if fc.name in tool_names:
                    return CalledTarget(kind="tool", name=fc.name)
                # Model hallucinated a name that isn't in either set —
                # still record it as a tool-shaped call for debugging.
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


def _judge_pass(test: TestCase, outcome: RolloutOutcome) -> bool:
    if outcome.error or outcome.called is None:
        return False
    called = outcome.called
    exp = test.expect
    if exp.kind == "none":
        return called.kind == "none"
    if called.kind != exp.kind or called.name != getattr(exp, "name", None):
        return False
    if test.mustNotCall and called.name and called.name in test.mustNotCall:
        return False
    return True


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
    except Exception as e:  # network / auth / rate limit — surface, don't crash
        latency = (time.perf_counter() - started) * 1000
        return RolloutOutcome(
            called=None,
            latencyMs=latency,
            steps=0,
            error=f"{type(e).__name__}: {e}",
        )


# ---------- Public entry ----------------------------------------------


def run_real(req: TestRunRequest) -> TestRunResponse:
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"real runner unavailable: {reason}")

    config = req.config or TestRunConfig()
    model = config.model or "gemini-2.5-flash"
    temperature = 0.0  # phase 11: deterministic single rollout

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
    results: list[TestResult] = []

    for tc in req.testCases:
        outcome = _run_one(
            client, model, req.prompt, tc, tools, tool_names, skill_names, temperature,
        )
        passed = _judge_pass(tc, outcome)
        pass_rate = 1.0 if passed else 0.0
        # No logprobs from function-call responses on Gemini yet; phase 12
        # will explore whether an alternative signal (top-k reranking probe)
        # gives us confidence here.
        routing_score = 0.7 * pass_rate + 0.3 * pass_rate  # collapses to passRate
        results.append(
            TestResult(
                testId=tc.id,
                passRate=pass_rate,
                meanLogprob=None,
                meanSteps=float(outcome.steps),
                latencyP50=outcome.latencyMs,
                routingScore=routing_score,
                rollouts=[outcome],
                mock=False,
            )
        )

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=results,
        durationMs=duration,
        sidecarVersion=f"0.2.0-genai-{model}",
    )
