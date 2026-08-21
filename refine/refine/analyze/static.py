"""Deterministic lints for AgentSpecs.

Two categories of checks:

1. **Regex- and threshold-shaped rules** live as data in
   `refine/rules/patterns.yaml` and run through `refine.rules.run_ruleset`.
   Every one of those rules cites the section of `docs/` that grounds it,
   so findings are traceable back to the research.

2. **Graph-shaped checks** — cross-referencing tools ↔ prompt, walking
   the subagent list, computing similarity ratios — live here as plain
   Python. They don't compress into data cleanly, and forcing them into
   a rule-DSL would cost clarity for no real gain.

To add a new pattern rule: edit `patterns.yaml`.
To add a new graph rule: write a function here and add it to `CHECKS`.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from refine.models import AgentSpec, Finding, Severity
from refine.rules import run_ruleset


# ---------------------------------------------------------------------------
# Thresholds for the graph-shaped checks (the ones that stay in Python)
# ---------------------------------------------------------------------------

SIMILARITY_THRESHOLD = 0.72
"""Ratio at which two skill/subagent descriptions are 'basically the same'."""


# ---------------------------------------------------------------------------
# Graph-shaped checks
# ---------------------------------------------------------------------------


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
            source="static",
            docs_ref="docs/01-fundamentals.md § 1 (Be clear and direct)",
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
            source="static",
            docs_ref="docs/04-agentic-and-advanced.md § Subagent orchestration",
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
            source="static",
            docs_ref="docs/04-agentic-and-advanced.md § Context engineering",
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
                    source="static",
                    docs_ref="docs/06-anti-patterns.md § 3 (Example contamination / duplicate authority)",
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
                    source="static",
                    docs_ref="docs/06-anti-patterns.md § 3 (duplicate authority)",
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
        tool_words -= _STOPWORDS
        if not tool_words:
            continue
        overlap = tool_words & prompt_words
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
                    source="static",
                    docs_ref="docs/01-fundamentals.md § 5 (Structure prompts with delimiters)",
                )
            )
    return findings


def check_undefined_tool_references(agent: AgentSpec) -> list[Finding]:
    """The prompt mentions a callable in tool-invocation style that isn't in the tool list."""
    tool_names = {t.name for t in agent.tools}
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
                    source="static",
                    docs_ref="docs/06-anti-patterns.md § 1 (Vague prompts)",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

GRAPH_CHECKS = [
    check_orphan_tools,
    check_orphan_subagents,
    check_orphan_skills,
    check_duplicate_authority,
    check_tool_description_drift,
    check_undefined_tool_references,
]


def run_static_lints(agent: AgentSpec) -> list[Finding]:
    """Run every static check and return a flat list of findings.

    Runs the YAML-driven ruleset first (pattern-family checks), then the
    Python graph checks. Both produce `Finding`s with `source='static'`.
    """
    out: list[Finding] = []
    # 1. Data-driven pattern rules from refine/rules/patterns.yaml
    out.extend(run_ruleset(agent))
    # 2. Graph-shaped checks that stay Python
    for check in GRAPH_CHECKS:
        out.extend(check(agent))
    return out


# ---------------------------------------------------------------------------
# Small helpers used by the graph checks above
# ---------------------------------------------------------------------------

_WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on",
    "at", "by", "is", "are", "be", "this", "that", "it", "as", "from",
    "you", "your", "we", "our", "will", "can", "should", "must", "not",
    "do", "does", "if", "when", "then", "into", "over", "under", "any",
    "all", "one", "two", "three", "use", "used", "using", "call", "calls",
    "return", "returns", "get", "set", "add", "list", "each",
}

_CALL_STYLE_WHITELIST = {
    "print", "len", "sum", "min", "max", "int", "str", "list", "dict",
    "float", "range", "any", "all", "type", "open",
}
