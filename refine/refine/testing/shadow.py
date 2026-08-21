"""Shadow execution harness for google-adk agents.

We do NOT actually let tools execute. Instead:

1. We build an `LlmAgent` from the AgentSpec, with a copy of each tool
   whose implementation is an interceptor that (a) records the call,
   (b) checks it against the TestCase's assertions, (c) returns the
   TestCase's mock response.

2. Subagents are stubbed. Each becomes a tiny `LlmAgent` whose only
   behaviour is: when invoked, mark the case's route as itself and
   return an "OK" transfer. This lets us catch routing decisions
   without paying to actually run the downstream agent.

3. Skills are proxied via a `load_skill(name)` tool. If the AgentSpec
   has any skills, we add that tool automatically; the interceptor
   records skill loads and returns the skill body.

If `google-adk` isn't installed, `run_tests()` raises with a clear
message pointing at the optional dependency.
"""

from __future__ import annotations

import asyncio
from typing import Any

from refine.models import (
    ActualToolCall,
    AgentSpec,
    ExpectedToolCall,
    TestCase,
    TestResult,
)
from refine.testing.judge import judge_skill_usage

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_tests(
    agent: AgentSpec,
    cases: list[TestCase],
    *,
    judge: bool = True,
) -> list[TestResult]:
    """Run every case against the agent under shadow execution."""
    _require_adk()
    results: list[TestResult] = []
    for case in cases:
        try:
            result = asyncio.run(_run_one(agent, case, judge=judge))
        except Exception as e:  # noqa: BLE001 — surface any harness error as a result
            result = TestResult(
                case_id=case.id,
                passed=False,
                error=f"{type(e).__name__}: {e}",
            )
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# Per-case executor
# ---------------------------------------------------------------------------


async def _run_one(agent: AgentSpec, case: TestCase, *, judge: bool) -> TestResult:
    from google.adk.agents import LlmAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    trace = _Trace()

    # Wrap each tool with an interceptor bound to this case.
    tools = [_make_intercepted_tool(t, case, trace) for t in agent.tools]

    # Add the skill loader tool if the agent has any skills.
    if agent.skills:
        tools.append(_make_skill_loader(agent, case, trace))

    # Stub every subagent as a tiny agent that just marks the route.
    subagents = [_make_stub_subagent(sub.name, sub.description, trace) for sub in agent.subagents]

    llm_agent = LlmAgent(
        name=agent.name,
        model=agent.model or "gemini-2.5-pro",
        description=f"Shadow harness for {agent.name}",
        instruction=agent.system_prompt,
        tools=tools,
        sub_agents=subagents,
    )

    session_service = InMemorySessionService()
    app_name = "refine-shadow"
    user_id = "refine"
    session = await session_service.create_session(app_name=app_name, user_id=user_id)

    runner = Runner(agent=llm_agent, app_name=app_name, session_service=session_service)

    final_text_parts: list[str] = []
    async for event in runner.run_async(
        session_id=session.id,
        user_id=user_id,
        new_message=types.Content(role="user", parts=[types.Part(text=case.input)]),
    ):
        # Track route transfers ADK signals in event metadata.
        author = getattr(event, "author", None) or ""
        if author and author != agent.name and author not in {"user", "system"}:
            trace.route = author

        # Collect text output for the transcript.
        if getattr(event, "is_final_response", None) and event.is_final_response():
            for part in getattr(event.content, "parts", []) or []:
                if getattr(part, "text", None):
                    final_text_parts.append(part.text)

    return _build_result(
        agent=agent,
        case=case,
        trace=trace,
        transcript="".join(final_text_parts),
        judge=judge,
    )


# ---------------------------------------------------------------------------
# Interceptors — the "hook the tool" part the user described
# ---------------------------------------------------------------------------


class _Trace:
    """Bag of things the interceptors accumulate during one run."""

    def __init__(self) -> None:
        self.tool_calls: list[ActualToolCall] = []
        self.skills_loaded: list[str] = []
        self.route: str | None = None
        self._turn: int = 0

    def next_turn(self) -> int:
        self._turn += 1
        return self._turn


def _make_intercepted_tool(spec, case: TestCase, trace: _Trace):
    """Return a google-adk FunctionTool whose body is our interceptor."""
    from google.adk.tools import FunctionTool

    # Build a small function whose signature carries a **kwargs so ADK
    # can pass whatever the model produced. We don't try to validate the
    # arg schema here — that's the analyzer's job upstream, and the
    # harness's job is just to record and return.
    def _impl(**kwargs: Any) -> Any:  # noqa: ANN401 — genuinely opaque
        turn = trace.next_turn()
        trace.tool_calls.append(
            ActualToolCall(tool_name=spec.name, args=dict(kwargs), turn=turn)
        )
        # Case-provided mock takes priority.
        for expected in case.expected_tools:
            if expected.tool_name == spec.name and expected.mock_response is not None:
                return expected.mock_response
        return case.default_mock

    _impl.__name__ = spec.name
    _impl.__doc__ = spec.description
    return FunctionTool(func=_impl)


def _make_skill_loader(agent: AgentSpec, case: TestCase, trace: _Trace):
    """Synthetic `load_skill(name)` tool that records loads."""
    from google.adk.tools import FunctionTool

    skills_by_name = {s.name: s for s in agent.skills}
    catalog = "\n".join(f"- {s.name}: {s.description}" for s in agent.skills)

    def load_skill(name: str) -> str:
        """Load the on-demand skill with the given `name` and return its body.

        Available skills:
        """
        turn = trace.next_turn()
        trace.tool_calls.append(
            ActualToolCall(tool_name="load_skill", args={"name": name}, turn=turn)
        )
        trace.skills_loaded.append(name)
        skill = skills_by_name.get(name)
        if not skill:
            return f"ERROR: no skill named '{name}'. Available skills:\n{catalog}"
        return skill.body

    # Append the catalog to the docstring so the model can see the list.
    load_skill.__doc__ = (load_skill.__doc__ or "") + "\n" + catalog
    return FunctionTool(func=load_skill)


def _make_stub_subagent(name: str, description: str, trace: _Trace):
    """A minimal sub-LlmAgent that just signals 'I was routed to' and exits."""
    from google.adk.agents import LlmAgent

    # The stub uses the smallest capable model to keep costs down; if the
    # AgentSpec's own model is Gemini, this default matches.
    return LlmAgent(
        name=name,
        model="gemini-2.5-flash",
        description=description,
        instruction=(
            f"You are the stub for the '{name}' subagent inside the refine shadow "
            "harness. When invoked, reply with exactly one short sentence "
            f"acknowledging that you were routed to for: {description}. Do not "
            "attempt to complete the user's task."
        ),
    )


# ---------------------------------------------------------------------------
# Assertion evaluation
# ---------------------------------------------------------------------------


def _build_result(
    *,
    agent: AgentSpec,
    case: TestCase,
    trace: _Trace,
    transcript: str,
    judge: bool,
) -> TestResult:
    # Routing --------------------------------------------------------------
    route_ok: bool | None = None
    if case.expected_route is not None:
        route_ok = trace.route == case.expected_route

    # Tool assertions ------------------------------------------------------
    called_names_ordered = [c.tool_name for c in trace.tool_calls if c.tool_name != "load_skill"]
    called_set = set(called_names_ordered)
    expected_names = [e.tool_name for e in case.expected_tools]
    expected_set = set(expected_names)

    tools_missing = [n for n in expected_names if n not in called_set]

    allowed = expected_set | {"load_skill"}
    tools_unexpected = [n for n in called_names_ordered if n not in allowed]

    # Args subset check for the ones that were called
    for expected in case.expected_tools:
        if expected.args_contains is None:
            continue
        match = next(
            (c for c in trace.tool_calls if c.tool_name == expected.tool_name),
            None,
        )
        if match is None:
            continue
        for k, v in expected.args_contains.items():
            if match.args.get(k) != v:
                tools_missing.append(f"{expected.tool_name}(args:{k}={v!r})")
                break

    # Forbidden tools ------------------------------------------------------
    forbidden_hit = [n for n in called_names_ordered if n in case.forbidden_tools]

    # Skills ---------------------------------------------------------------
    skills_missing = [n for n in case.expected_skills if n not in trace.skills_loaded]

    # Judge ----------------------------------------------------------------
    skill_score: float | None = None
    skill_reason: str | None = None
    if judge and case.judge_criteria and trace.skills_loaded:
        skill_score, skill_reason = judge_skill_usage(
            agent=agent,
            case=case,
            skills_loaded=trace.skills_loaded,
            transcript=transcript,
            tool_calls=trace.tool_calls,
        )

    passed = (
        (route_ok in (None, True))
        and not tools_missing
        and not tools_unexpected
        and not forbidden_hit
        and not skills_missing
        and (skill_score is None or skill_score >= 0.7)
    )

    return TestResult(
        case_id=case.id,
        passed=passed,
        route_ok=route_ok,
        actual_route=trace.route,
        tools_called=list(trace.tool_calls),
        tools_missing=tools_missing,
        tools_unexpected=tools_unexpected,
        forbidden_tools_hit=forbidden_hit,
        skills_loaded=list(trace.skills_loaded),
        skills_missing=skills_missing,
        skill_usage_score=skill_score,
        skill_usage_reason=skill_reason,
        transcript=transcript,
    )


# ---------------------------------------------------------------------------
# Optional dep guard
# ---------------------------------------------------------------------------


def _require_adk() -> None:
    try:
        import google.adk  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Shadow execution requires the 'google-adk' extra. "
            "Install it with: pip install 'refine[adk]'"
        ) from e
