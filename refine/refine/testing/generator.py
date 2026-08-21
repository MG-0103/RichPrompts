"""Auto-generate starter TestCases for an AgentSpec.

Given the prompt + tools + subagents + skills, ask Claude to propose a
diverse initial set of cases that exercise:

- happy-path routing for each subagent (if any)
- the ambiguous cases at the routing boundaries
- one case per tool that should trigger it
- one case per skill that should load it
- one or two adversarial cases (out-of-scope input, missing info)

The user is expected to edit these — they're scaffolding, not ground
truth. Every generated case is emitted with mock responses filled in.
"""

from __future__ import annotations

from refine.llm_client import LlmSettings, call_json
from refine.models import AgentSpec, ExpectedToolCall, TestCase


_SYSTEM = """You write test cases for AI agents. Given an agent's system \
prompt, its tools, its subagents, and its skills, you produce a diverse \
set of behavioural test cases that exercise routing, tool selection, \
and skill loading.

You aim for coverage, not volume. A good test-case set is:
- one case per tool that should trigger it (happy path)
- one case per subagent that should route to it (happy path)
- one case per skill that should load it (happy path)
- one or two ambiguous cases at the routing boundaries
- one adversarial case (out of scope, or missing information)

Each case gets a mock response for the tool calls that shouldn't hit the \
real world."""


_USER_TEMPLATE = """Generate test cases for this agent.

<agent_name>{name}</agent_name>

<system_prompt>
{prompt}
</system_prompt>

<tools>
{tools}
</tools>

<subagents>
{subagents}
</subagents>

<skills>
{skills}
</skills>

<output_format>
Return a JSON object of the form:

{{
  "cases": [
    {{
      "id": "kebab-case-slug",
      "input": "the user message",
      "expected_route": "name of the subagent that should handle this, or null if the current agent should",
      "expected_tools": [
        {{
          "tool_name": "search_web",
          "args_contains": {{"query": "..."}},
          "mock_response": "..."
        }}
      ],
      "expected_skills": ["skill_name_1", "skill_name_2"],
      "forbidden_tools": [],
      "judge_criteria": "one sentence describing what 'correct skill usage' looks like for this case, or null",
      "default_mock": "ok"
    }}
  ]
}}

Rules:
- Do not wrap the JSON in prose. Return only the JSON object.
- Cover every tool, subagent, and skill at least once across the case set.
- Use realistic-looking mock responses.
- Keep each case's input to one or two sentences.
- Keep the set to at most {max_cases} cases.
</output_format>"""


def generate_test_cases(
    agent: AgentSpec,
    *,
    max_cases: int = 12,
    model: str = "claude-opus-5",
) -> list[TestCase]:
    user = _USER_TEMPLATE.format(
        name=agent.name,
        prompt=agent.system_prompt,
        tools=_render_tools(agent),
        subagents=_render_subagents(agent),
        skills=_render_skills(agent),
        max_cases=max_cases,
    )

    raw = call_json(
        system=_SYSTEM,
        user=user,
        settings=LlmSettings(model=model),
    )

    cases: list[TestCase] = []
    for c in raw.get("cases", []):
        cases.append(
            TestCase(
                id=c["id"],
                input=c["input"],
                expected_route=c.get("expected_route"),
                expected_tools=[
                    ExpectedToolCall(
                        tool_name=t["tool_name"],
                        args_contains=t.get("args_contains"),
                        mock_response=t.get("mock_response"),
                    )
                    for t in c.get("expected_tools", [])
                ],
                expected_skills=list(c.get("expected_skills", []) or []),
                forbidden_tools=list(c.get("forbidden_tools", []) or []),
                judge_criteria=c.get("judge_criteria"),
                default_mock=c.get("default_mock", "ok"),
            )
        )
    return cases


# ---------------------------------------------------------------------------
# Helpers (shared shape with analyze/llm.py — kept small and local)
# ---------------------------------------------------------------------------


def _render_tools(agent: AgentSpec) -> str:
    if not agent.tools:
        return "(none)"
    return "\n".join(f"- {t.name}: {t.description}" for t in agent.tools)


def _render_subagents(agent: AgentSpec) -> str:
    if not agent.subagents:
        return "(none)"
    return "\n".join(f"- {s.name}: {s.description}" for s in agent.subagents)


def _render_skills(agent: AgentSpec) -> str:
    if not agent.skills:
        return "(none)"
    return "\n".join(f"- {s.name}: {s.description}" for s in agent.skills)
