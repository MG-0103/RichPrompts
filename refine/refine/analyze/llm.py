"""LLM-based analysis of an AgentSpec.

Uses Claude Opus 5 (adaptive thinking on) to produce structured findings
plus a suggested rewrite of the system prompt.

Loads the source-of-truth docs (docs/01, docs/06, BEST_TECHNIQUES.md)
into the reviewer's system prompt as a cached block, and asks the
reviewer to evaluate the agent *against those principles* and *cite the
section that applies*. Editing the docs updates the reviewer's judgment
without any code change.

If the docs aren't on disk (e.g. the package was installed standalone
into another repo), the reviewer falls back to a compact in-prompt
summary of the same principles. Findings won't carry docs_refs in that
mode.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from refine.llm_client import LlmSettings, call_json
from refine.models import AgentSpec, Finding, Severity


# ---------------------------------------------------------------------------
# System prompt (two forms: with-docs and standalone)
# ---------------------------------------------------------------------------


_ROLE = """You are a staff-level prompt engineer reviewing an agent \
definition inside a larger multi-agent system.

Your job is to identify issues in the agent's system prompt, tool set, \
subagent list, and skill list that will hurt real-world quality: \
under-specified triggers, contradictions, orphan capabilities, \
overlapping authority between skills or subagents, over-engineered \
rules that will over-trigger on modern models, and rules whose 'why' \
is missing.

You never invent rules the author didn't have. You never make sweeping \
'best practice' suggestions that would require rewriting the whole \
agent. Every finding must point at a concrete line or field."""


_REVIEW_INSTRUCTION_WITH_DOCS = """The <principles> block above is the \
authoritative reference for how prompts and multi-agent configurations \
should be structured in this project. Every finding you make must be \
grounded in a specific principle from those docs.

For each finding, populate a `docs_ref` field naming the section that \
grounds it — e.g. 'docs/06-anti-patterns.md § 8' or \
'BEST_TECHNIQUES.md — When the task is knowledge-heavy'. If a finding \
you'd like to raise has no analogue in the docs, either skip it or \
still raise it but leave `docs_ref` null (do not invent a citation)."""


_REVIEW_INSTRUCTION_STANDALONE = """Look for these classes of issue:

1. Necessary vs. compressible: which parts of the prompt pull weight, which are duplicative or dead?
2. Under-specified triggers: any rule that says "when appropriate", "if needed", etc.
3. Contradictions: two rules that could conflict; a rule that contradicts a tool description or skill body.
4. Orphan capabilities: tools/subagents/skills with no clear trigger condition anywhere in the prompt.
5. Enforcement drift: rules that should be more concrete; missing failure paths.
6. Over-engineered emphasis: CRITICAL/MUST/NEVER used so often the model stops giving each rule weight.
7. Missing 'why': constraints with no rationale.

Leave `docs_ref` null for every finding — the reference docs are unavailable in this run."""


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

<output_format>
Return a JSON object with exactly these keys:

{{
  "findings": [
    {{
      "severity": "info" | "warn" | "error",
      "category": "kebab-case slug",
      "message": "one-sentence description of the issue",
      "suggestion": "one-sentence concrete fix",
      "location": "e.g. 'system_prompt:l17', 'tool:search_web', 'skill:analyze_pdf', or null",
      "docs_ref": "e.g. 'docs/06-anti-patterns.md § 8', or null if no matching principle"
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


# ---------------------------------------------------------------------------
# Doc loading (source-of-truth wiring)
# ---------------------------------------------------------------------------


DOCS_TO_LOAD = (
    "docs/01-fundamentals.md",
    "docs/06-anti-patterns.md",
    "BEST_TECHNIQUES.md",
)


def _find_repo_root() -> Path | None:
    """Best-effort locate the RichPrompts repo root that houses `docs/`.

    Walks up from this file until it finds a directory that contains
    both a `docs/` subfolder and this refine package. Returns None if
    it can't find one (e.g. the wheel was installed into another repo).
    """
    here = Path(__file__).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "docs").is_dir() and (candidate / "BEST_TECHNIQUES.md").exists():
            return candidate
    return None


def _load_principles() -> str | None:
    """Read the source-of-truth docs and wrap them for prompt injection."""
    root = _find_repo_root()
    if root is None:
        return None
    parts: list[str] = []
    for rel in DOCS_TO_LOAD:
        path = root / rel
        if not path.exists():
            continue
        parts.append(f'<doc path="{rel}">\n{path.read_text(encoding="utf-8")}\n</doc>')
    if not parts:
        return None
    return "<principles>\n" + "\n\n".join(parts) + "\n</principles>"


def _build_system(principles: str | None) -> str | list[dict[str, Any]]:
    """Build the system prompt.

    If we have the docs, return a two-block array where the docs are
    marked `cache_control: ephemeral` so we pay their token cost once
    per prompt-cache lifetime instead of per agent reviewed.

    If we don't, fall back to a compact standalone string.
    """
    if principles is None:
        return _ROLE + "\n\n" + _REVIEW_INSTRUCTION_STANDALONE
    return [
        {
            "type": "text",
            "text": principles,
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": _ROLE + "\n\n" + _REVIEW_INSTRUCTION_WITH_DOCS,
        },
    ]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def analyze_with_llm(
    agent: AgentSpec,
    *,
    model: str = "claude-opus-5",
) -> tuple[list[Finding], str | None]:
    """Run the LLM reviewer. Returns (findings, suggested_prompt)."""
    principles = _load_principles()
    system = _build_system(principles)

    user = _USER_TEMPLATE.format(
        name=agent.name,
        prompt=agent.system_prompt,
        tools=_render_tools(agent),
        subagents=_render_subagents(agent),
        skills=_render_skills(agent),
    )

    raw = call_json(
        system=system,
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
            docs_ref=f.get("docs_ref"),
        )
        for f in raw.get("findings", [])
    ]
    suggested_prompt = raw.get("suggested_prompt") or None
    return findings, suggested_prompt


# ---------------------------------------------------------------------------
# Rendering helpers
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
        body = s.body if len(s.body) <= 4000 else s.body[:4000] + "\n... (truncated)"
        out.append(f"  body: |\n{_indent(body, 4)}")
    return "\n".join(out)


def _indent(text: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(pad + line for line in text.splitlines())
