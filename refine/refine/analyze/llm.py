"""LLM-based analysis of an AgentSpec.

Uses Claude Opus 5 (adaptive thinking on) to produce structured findings
plus a suggested rewrite of the system prompt.

The prompt to Claude here IS itself a good example of the techniques
this whole repo documents: role, context-with-reason, XML tags, explicit
output format, and a few-shot-shaped rubric of what to look for.
"""

from __future__ import annotations

import json
from typing import Any

from refine.llm_client import LlmSettings, call_json
from refine.models import AgentSpec, Finding, Severity


_SYSTEM = """You are a staff-level prompt engineer reviewing an agent \
definition inside a larger multi-agent system.

Your job is to identify issues in the agent's system prompt, tool set, \
subagent list, and skill list that will hurt real-world quality: \
under-specified triggers, contradictions, orphan capabilities, \
overlapping authority between skills or subagents, over-engineered rules \
that will over-trigger on modern models, and rules whose 'why' is \
missing.

You never invent rules the author didn't have. You never make sweeping \
'best practice' suggestions that would require rewriting the whole \
agent. Every finding must point at a concrete line or field."""


_USER_TEMPLATE = """Review this agent definition and return your findings as a JSON object.

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

<what_to_look_for>
1. Necessary vs. compressible: which parts of the prompt are pulling weight, which are duplicative or dead?
2. Under-specified triggers: any rule that says "when appropriate", "if needed", or otherwise leaves the trigger to model intuition when the workflow actually has a concrete condition.
3. Contradictions: two rules that could conflict; a rule that contradicts a tool description or a skill body.
4. Orphan capabilities: tools/subagents/skills defined but with no clear trigger condition anywhere in the prompt (or duplicated with another capability).
5. Enforcement drift: rules that should be enforced more concretely (e.g. "prefer" -> "always" or vice versa; missing failure paths like "if you can't, say ...").
6. Over-engineered emphasis: CRITICAL/MUST/NEVER used so often the model stops giving each rule weight.
7. Missing "why": constraints with no rationale, which the model has trouble generalising from.
</what_to_look_for>

<output_format>
Return a JSON object with exactly these keys:

{{
  "findings": [
    {{
      "severity": "info" | "warn" | "error",
      "category": "kebab-case-slug (choose from: compressible, under-specified-trigger, contradiction, orphan-capability, enforcement-drift, over-emphasis, missing-rationale, or another slug you invent)",
      "message": "one-sentence description of the issue",
      "suggestion": "one-sentence concrete fix",
      "location": "e.g. 'system_prompt:l17', 'tool:search_web', 'skill:analyze_pdf', or null"
    }}
  ],
  "suggested_prompt": "A rewritten version of the system prompt that addresses the findings. Preserve the author's intent. Do not add capabilities that weren't in the original."
}}

Rules for the output:
- Do not wrap the JSON in prose. Return the JSON object and nothing else.
- Do not invent findings to fill space. If the agent is clean, return an empty findings list.
- Order findings by severity (error first) then by importance.
- Keep each `message` and `suggestion` to one sentence.
</output_format>"""


def analyze_with_llm(
    agent: AgentSpec,
    *,
    model: str = "claude-opus-5",
) -> tuple[list[Finding], str | None]:
    """Run the LLM reviewer. Returns (findings, suggested_prompt)."""
    user = _USER_TEMPLATE.format(
        name=agent.name,
        prompt=agent.system_prompt,
        tools=_render_tools(agent),
        subagents=_render_subagents(agent),
        skills=_render_skills(agent),
    )

    raw = call_json(
        system=_SYSTEM,
        user=user,
        settings=LlmSettings(model=model),
    )

    findings = [
        Finding(
            severity=Severity(f.get("severity", "info")),
            category=f.get("category", "llm-finding"),
            message=f.get("message", ""),
            suggestion=f.get("suggestion", ""),
            location=f.get("location"),
            source="llm",
        )
        for f in raw.get("findings", [])
    ]
    suggested_prompt = raw.get("suggested_prompt") or None
    return findings, suggested_prompt


# ---------------------------------------------------------------------------
# Rendering helpers — kept close to how a human would read the definitions
# ---------------------------------------------------------------------------


def _render_tools(agent: AgentSpec) -> str:
    if not agent.tools:
        return "(none)"
    out = []
    for t in agent.tools:
        out.append(f"- name: {t.name}")
        out.append(f"  description: {t.description}")
        out.append(
            f"  parameters: {json.dumps(t.parameters, indent=2, sort_keys=True)}"
        )
    return "\n".join(out)


def _render_subagents(agent: AgentSpec) -> str:
    if not agent.subagents:
        return "(none)"
    return "\n".join(
        f"- name: {s.name}\n  description: {s.description}" for s in agent.subagents
    )


def _render_skills(agent: AgentSpec) -> str:
    if not agent.skills:
        return "(none)"
    out = []
    for s in agent.skills:
        out.append(f"- name: {s.name}")
        out.append(f"  description: {s.description}")
        # Keep skill body under a reasonable cap so the reviewer prompt
        # stays cache-friendly across multiple agents.
        body = s.body if len(s.body) <= 4000 else s.body[:4000] + "\n... (truncated)"
        out.append(f"  body: |\n{_indent(body, 4)}")
    return "\n".join(out)


def _indent(text: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(pad + line for line in text.splitlines())
