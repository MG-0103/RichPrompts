"""LLM-judge for skill-usage correctness.

Given the trace of one shadow-execution run, plus the skill bodies that
were loaded during it, ask Claude to score whether the skill's guidance
was actually followed.

Returns `(score in [0, 1], reason)`. `score >= 0.7` counts as a pass in
`TestResult.passed`.
"""

from __future__ import annotations

import json
from typing import Iterable

from refine.llm_client import LlmSettings, call_json
from refine.models import ActualToolCall, AgentSpec, TestCase


_SYSTEM = """You are a meticulous evaluator of agent runs. You are given the \
guidance from one or more skills that the agent loaded during a task, \
and a trace of what the agent actually did. You must score, on a scale \
from 0.0 to 1.0, how faithfully the agent's actions followed the loaded \
skill's guidance.

You do not judge the outcome — only whether the guidance was followed. \
A skill saying 'always call cite_source after making a factual claim' \
should score 0.0 if the agent never called cite_source, even if the \
final answer was correct."""


_USER_TEMPLATE = """<test_case>
id: {case_id}
input: {input}
custom_criteria: {criteria}
</test_case>

<loaded_skills>
{skills}
</loaded_skills>

<agent_actions>
{actions}
</agent_actions>

<agent_final_response>
{transcript}
</agent_final_response>

<output_format>
Return a JSON object of the form:

{{
  "score": 0.0-1.0,
  "reason": "one to three sentences citing the specific skill rule and specific action (or missing action)"
}}

Do not wrap the JSON in prose. Return only the JSON object.
</output_format>"""


def judge_skill_usage(
    *,
    agent: AgentSpec,
    case: TestCase,
    skills_loaded: list[str],
    transcript: str,
    tool_calls: Iterable[ActualToolCall],
) -> tuple[float, str]:
    skills_by_name = {s.name: s for s in agent.skills}
    skill_bodies = []
    for name in skills_loaded:
        s = skills_by_name.get(name)
        if not s:
            continue
        skill_bodies.append(f"# skill: {name}\n{s.body}")

    actions = "\n".join(
        f"turn {c.turn}: {c.tool_name}({json.dumps(c.args, sort_keys=True)})"
        for c in tool_calls
    )

    user = _USER_TEMPLATE.format(
        case_id=case.id,
        input=case.input,
        criteria=case.judge_criteria or "(none supplied — judge purely on skill fidelity)",
        skills="\n\n".join(skill_bodies) or "(none)",
        actions=actions or "(no tool calls)",
        transcript=transcript or "(no final response)",
    )

    raw = call_json(
        system=_SYSTEM,
        user=user,
        settings=LlmSettings(effort="medium"),
    )
    score = float(raw.get("score", 0.0))
    reason = str(raw.get("reason", ""))
    # Clamp defensively.
    score = max(0.0, min(1.0, score))
    return score, reason
