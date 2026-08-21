"""Deterministic lints for AgentSpecs.

No LLM calls. All checks are fast, idempotent, and side-effect-free.
Each check returns zero or more Findings. `run_static_lints()` runs them
all and returns the merged list.

The threshold constants at the top are tunable. They are chosen to catch
the failure modes that come up over and over in real multi-agent
codebases, not to hit some abstract "best practice" number.
"""

from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher
from typing import Iterable

from refine.models import AgentSpec, Finding, Severity, SkillSpec, SubagentRef, ToolSpec

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

MAX_PROMPT_CHARS = 12_000
"""Above this, prompts empirically start losing per-rule attention."""

MAX_INSTRUCTION_LINES = 40
"""Rough proxy for instruction stacking — bullets, numbered items, imperatives."""

MAX_CRITICAL_MUST_HITS = 3
"""More than this and the emphatic language stops meaning anything."""

SIMILARITY_THRESHOLD = 0.72
"""Ratio at which two skill/subagent descriptions are 'basically the same'."""

# Regexes ---------------------------------------------------------------------

_INSTRUCTION_LINE = re.compile(
    r"^\s*(?:[-*+]|\d+[.)]|(?:MUST|SHOULD|NEVER|DO NOT|DON'T|ALWAYS)\b)",
    re.IGNORECASE,
)
_CRITICAL_MUST = re.compile(
    r"\b(?:CRITICAL|IMPORTANT|MUST|MANDATORY|ALWAYS|NEVER|DO NOT|DON'T)\b",
)
_NEGATIVE_ONLY = re.compile(
    r"^\s*(?:do not|don't|never|avoid|no)\b",
    re.IGNORECASE,
)
_WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_prompt_length(agent: AgentSpec) -> list[Finding]:
    n = len(agent.system_prompt)
    if n <= MAX_PROMPT_CHARS:
        return []
    return [
        Finding(
            severity=Severity.WARN,
            category="prompt-too-long",
            message=(
                f"System prompt is {n:,} characters (>{MAX_PROMPT_CHARS:,}); "
                "per-rule attention degrades at this length."
            ),
            suggestion=(
                "Compress or split into a lean system prompt plus on-demand skills."
            ),
            location="system_prompt",
        )
    ]


def check_instruction_stacking(agent: AgentSpec) -> list[Finding]:
    lines = [ln for ln in agent.system_prompt.splitlines() if _INSTRUCTION_LINE.match(ln)]
    if len(lines) <= MAX_INSTRUCTION_LINES:
        return []
    return [
        Finding(
            severity=Severity.WARN,
            category="instruction-stacking",
            message=(
                f"System prompt contains ~{len(lines)} rule-like lines "
                f"(> {MAX_INSTRUCTION_LINES}); attention on any single rule drops."
            ),
            suggestion=(
                "Consolidate related rules, group under headings, "
                "or move rarely-firing rules into on-demand skills."
            ),
            location="system_prompt",
        )
    ]


def check_critical_must_inflation(agent: AgentSpec) -> list[Finding]:
    hits = _CRITICAL_MUST.findall(agent.system_prompt)
    if len(hits) <= MAX_CRITICAL_MUST_HITS:
        return []
    return [
        Finding(
            severity=Severity.INFO,
            category="critical-must-inflation",
            message=(
                f"Emphatic tokens (CRITICAL/MUST/NEVER/…) appear {len(hits)} times; "
                "on frontier models this often causes over-triggering."
            ),
            suggestion=(
                "Reserve emphatic language for rules whose violation would cause harm; "
                "downgrade the rest to 'Use this when …'."
            ),
            location="system_prompt",
        )
    ]


def check_negative_only_instructions(agent: AgentSpec) -> list[Finding]:
    hits = 0
    for line in agent.system_prompt.splitlines():
        stripped = line.strip("-*+ \t")
        if _NEGATIVE_ONLY.match(stripped):
            hits += 1
    if hits < 3:
        return []
    return [
        Finding(
            severity=Severity.INFO,
            category="negative-only-instructions",
            message=(
                f"{hits} instructions are framed as prohibitions ('do not …'); "
                "models suppress prohibited things less reliably than they follow positive directives."
            ),
            suggestion="Recast each 'Don't X' as 'Do Y' where possible.",
            location="system_prompt",
        )
    ]


def check_orphan_tools(agent: AgentSpec) -> list[Finding]:
    """Tools defined but never mentioned in the system prompt."""
    body = agent.system_prompt.lower()
    return [
        Finding(
            severity=Severity.WARN,
            category="orphan-tool",
            message=(
                f"Tool '{tool.name}' is available but never mentioned in the system prompt — "
                "the agent has no explicit trigger condition for it."
            ),
            suggestion=(
                f"Add a sentence telling the agent when to use '{tool.name}', or remove the tool."
            ),
            location=f"tool:{tool.name}",
        )
        for tool in agent.tools
        if tool.name.lower() not in body
    ]


def check_orphan_subagents(agent: AgentSpec) -> list[Finding]:
    body = agent.system_prompt.lower()
    return [
        Finding(
            severity=Severity.WARN,
            category="orphan-subagent",
            message=(
                f"Subagent '{sub.name}' is available but never mentioned in the system prompt — "
                "routing to it is left to model intuition."
            ),
            suggestion=(
                f"Add explicit routing guidance for '{sub.name}', or remove it from the subagent list."
            ),
            location=f"subagent:{sub.name}",
        )
        for sub in agent.subagents
        if sub.name.lower() not in body
    ]


def check_orphan_skills(agent: AgentSpec) -> list[Finding]:
    body = agent.system_prompt.lower()
    return [
        Finding(
            severity=Severity.INFO,
            category="orphan-skill",
            message=(
                f"Skill '{skill.name}' is available but never named in the system prompt; "
                "the agent relies entirely on the skill's own description for triggering."
            ),
            suggestion=(
                f"If the skill's description is confident, this is fine. "
                f"If not, mention '{skill.name}' explicitly in the prompt."
            ),
            location=f"skill:{skill.name}",
        )
        for skill in agent.skills
        if skill.name.lower() not in body
    ]


def check_duplicate_authority(agent: AgentSpec) -> list[Finding]:
    """Two skills, or two subagents, whose descriptions look near-identical."""
    findings: list[Finding] = []

    def _pairs(items):
        for i, a in enumerate(items):
            for b in items[i + 1 :]:
                yield a, b

    for a, b in _pairs(agent.skills):
        ratio = SequenceMatcher(None, a.description, b.description).ratio()
        if ratio >= SIMILARITY_THRESHOLD:
            findings.append(
                Finding(
                    severity=Severity.WARN,
                    category="duplicate-authority",
                    message=(
                        f"Skills '{a.name}' and '{b.name}' have highly similar descriptions "
                        f"(ratio={ratio:.2f}); the agent has no clear way to pick between them."
                    ),
                    suggestion=(
                        "Rewrite each description to name what makes it uniquely applicable, "
                        "or merge the two skills."
                    ),
                    location=f"skills:{a.name},{b.name}",
                )
            )

    for a, b in _pairs(agent.subagents):
        ratio = SequenceMatcher(None, a.description, b.description).ratio()
        if ratio >= SIMILARITY_THRESHOLD:
            findings.append(
                Finding(
                    severity=Severity.WARN,
                    category="duplicate-authority",
                    message=(
                        f"Subagents '{a.name}' and '{b.name}' have highly similar descriptions "
                        f"(ratio={ratio:.2f}); routing between them will be unreliable."
                    ),
                    suggestion=(
                        "Sharpen the descriptions to state what each is uniquely for, "
                        "or collapse them into one subagent."
                    ),
                    location=f"subagents:{a.name},{b.name}",
                )
            )

    return findings


def check_tool_description_drift(agent: AgentSpec) -> list[Finding]:
    """Tools whose docstring words never appear near their name in the prompt.

    Not a proof of drift — just a hint that the tool's own description
    and how the prompt talks about it diverge.
    """
    findings: list[Finding] = []
    prompt_words = set(w.lower() for w in _WORD.findall(agent.system_prompt))
    for tool in agent.tools:
        tool_words = {w.lower() for w in _WORD.findall(tool.description)}
        # keep only content-y words; drop common stopwords
        tool_words -= _STOPWORDS
        if not tool_words:
            continue
        overlap = tool_words & prompt_words
        # If literally none of the tool's content words appear anywhere in
        # the prompt, and the tool name IS in the prompt, that's a drift.
        if not overlap and tool.name.lower() in prompt_words:
            findings.append(
                Finding(
                    severity=Severity.INFO,
                    category="tool-description-drift",
                    message=(
                        f"Tool '{tool.name}' is referenced in the prompt but none of the "
                        "content words from its description appear anywhere in the prompt."
                    ),
                    suggestion=(
                        "Align the wording: either the tool description or the prompt is stale."
                    ),
                    location=f"tool:{tool.name}",
                )
            )
    return findings


def check_undefined_tool_references(agent: AgentSpec) -> list[Finding]:
    """The prompt mentions a callable in tool-invocation style that isn't in the tool list."""
    tool_names = {t.name for t in agent.tools}
    # Very light heuristic: `tool_name(` or `use the X tool`
    findings: list[Finding] = []
    call_style = set(re.findall(r"\b([a-z_][a-z0-9_]{2,})\(", agent.system_prompt))
    for name in call_style:
        if name not in tool_names and name not in _CALL_STYLE_WHITELIST:
            findings.append(
                Finding(
                    severity=Severity.WARN,
                    category="undefined-tool-reference",
                    message=(
                        f"Prompt mentions '{name}(...)' but no tool named '{name}' is defined."
                    ),
                    suggestion=(
                        f"Either add a tool named '{name}' or rephrase the prompt so the model "
                        "doesn't try to invoke it."
                    ),
                    location="system_prompt",
                )
            )
    return findings


def check_ambiguous_when_appropriate(agent: AgentSpec) -> list[Finding]:
    """Phrases like 'when appropriate' with no definition of what that means."""
    hits = re.findall(
        r"when (?:appropriate|needed|necessary|possible|helpful|relevant)",
        agent.system_prompt,
        flags=re.IGNORECASE,
    )
    if not hits:
        return []
    return [
        Finding(
            severity=Severity.INFO,
            category="under-specified-trigger",
            message=(
                f"Prompt uses vague trigger phrases ({', '.join(sorted(set(h.lower() for h in hits)))}) "
                f"{len(hits)} times; the model has to guess what 'appropriate' means."
            ),
            suggestion=(
                "Replace each with an explicit rule: 'when X', 'if the user has already Y', etc."
            ),
            location="system_prompt",
        )
    ]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

CHECKS = [
    check_prompt_length,
    check_instruction_stacking,
    check_critical_must_inflation,
    check_negative_only_instructions,
    check_orphan_tools,
    check_orphan_subagents,
    check_orphan_skills,
    check_duplicate_authority,
    check_tool_description_drift,
    check_undefined_tool_references,
    check_ambiguous_when_appropriate,
]


def run_static_lints(agent: AgentSpec) -> list[Finding]:
    """Run every static check and return a flat list of findings."""
    out: list[Finding] = []
    for check in CHECKS:
        out.extend(check(agent))
    return out


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on",
    "at", "by", "is", "are", "be", "this", "that", "it", "as", "from",
    "you", "your", "we", "our", "will", "can", "should", "must", "not",
    "do", "does", "if", "when", "then", "into", "over", "under", "any",
    "all", "one", "two", "three", "use", "used", "using", "call", "calls",
    "return", "returns", "get", "set", "add", "list", "the", "each",
}

_CALL_STYLE_WHITELIST = {
    # common Python-y calls we don't want to flag as missing tools
    "print", "len", "sum", "min", "max", "int", "str", "list", "dict",
    "float", "range", "any", "all", "type", "open",
}
