"""Core data models for the refine tool.

An `AgentSpec` is the sole input to the analyzer and the shadow-execution
harness. Everything downstream (findings, test results, reports) speaks
these types too so the eventual web UI can render them without knowing
anything about how they were produced.

The model shapes are intentionally framework-agnostic. An ingest adapter
for google-adk (or any other stack) is responsible for translating from
the framework's native representation into these types.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Inputs — what a caller supplies
# ---------------------------------------------------------------------------


class ToolSpec(BaseModel):
    """One tool an agent can call.

    `parameters` is a JSON Schema for the tool's argument object, matching
    the shape google-adk (and every other tool-using SDK) uses.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    parameters: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}},
        description="JSON Schema for the tool's arguments.",
    )


class SkillSpec(BaseModel):
    """A SKILL.md-style skill the agent can load on demand.

    `description` is the trigger text used by the loading mechanism to
    decide when to inject `body` into context. Both matter to the
    analyzer: the description drives routing correctness, the body drives
    skill-usage correctness.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    body: str
    source_path: str | None = Field(
        default=None,
        description="Where this skill file lives on disk; used only for reporting.",
    )


class SubagentRef(BaseModel):
    """A reference to another agent this one can delegate to.

    The `description` here is what the parent agent's routing logic will
    match against — sharpening it is often the single highest-ROI edit in
    a multi-agent system.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    # Optional: a full spec for the subagent, so analysis can recurse. Not
    # required — a caller can pass just the name and description.
    spec: AgentSpec | None = None


class AgentSpec(BaseModel):
    """The full definition of a single agent, framework-agnostic."""

    model_config = ConfigDict(extra="forbid")

    name: str
    system_prompt: str
    tools: list[ToolSpec] = Field(default_factory=list)
    subagents: list[SubagentRef] = Field(default_factory=list)
    skills: list[SkillSpec] = Field(default_factory=list)
    model: str | None = Field(
        default=None,
        description="Model id the agent runs on (e.g. 'gemini-2.5-pro'). Used only by the shadow-execution harness; the analyzer is model-agnostic.",
    )

    # Loader helpers ------------------------------------------------------
    @classmethod
    def from_yaml(cls, path: str | Path) -> AgentSpec:
        import yaml

        with open(path) as f:
            return cls.model_validate(yaml.safe_load(f))

    @classmethod
    def from_json(cls, path: str | Path) -> AgentSpec:
        import json

        with open(path) as f:
            return cls.model_validate(json.load(f))


# Resolve the forward reference now that AgentSpec exists.
SubagentRef.model_rebuild()


# ---------------------------------------------------------------------------
# Analysis outputs
# ---------------------------------------------------------------------------


class Severity(str, Enum):
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


class Finding(BaseModel):
    """A single observation about an agent's configuration."""

    model_config = ConfigDict(extra="forbid")

    severity: Severity
    category: str = Field(description="Short kebab-case slug, e.g. 'orphan-tool'.")
    message: str = Field(description="One-sentence description of the issue.")
    suggestion: str = Field(description="One-sentence concrete fix.")
    location: str | None = Field(
        default=None,
        description="Free-form location hint, e.g. 'system_prompt:l42' or 'tool:search_web'.",
    )
    source: Literal["static", "llm"] = "static"
    docs_ref: str | None = Field(
        default=None,
        description=(
            "Reference to the docs section that grounds this finding, "
            "e.g. 'docs/06-anti-patterns.md § 8'. Populated by rules that "
            "cite a specific principle, so the report is traceable."
        ),
    )


class AnalysisReport(BaseModel):
    """The full analysis output for a single agent."""

    model_config = ConfigDict(extra="forbid")

    agent_name: str
    static_findings: list[Finding] = Field(default_factory=list)
    llm_findings: list[Finding] = Field(default_factory=list)
    suggested_prompt: str | None = Field(
        default=None,
        description="A proposed rewrite of the system prompt from the LLM analyzer. None if the LLM stage was skipped.",
    )

    @property
    def all_findings(self) -> list[Finding]:
        return [*self.static_findings, *self.llm_findings]

    @property
    def error_count(self) -> int:
        return sum(1 for f in self.all_findings if f.severity == Severity.ERROR)

    @property
    def warn_count(self) -> int:
        return sum(1 for f in self.all_findings if f.severity == Severity.WARN)


# ---------------------------------------------------------------------------
# Behavioral tests — inputs and outputs
# ---------------------------------------------------------------------------


class ExpectedToolCall(BaseModel):
    """One tool call we expect the agent to make during a test case.

    `args_contains` lets a case assert only a subset of the arguments —
    useful when the exact shape isn't the point of the test.

    `mock_response` is what the shadow harness returns for this call in
    place of actually executing the tool.
    """

    model_config = ConfigDict(extra="forbid")

    tool_name: str
    args_contains: dict[str, Any] | None = None
    mock_response: Any = None


class TestCase(BaseModel):
    """A single behavioral test.

    Optional fields let the case check only the aspects the author cares
    about. Leave `expected_route` unset to skip the routing check, etc.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    input: str = Field(description="The user message to send to the agent.")
    expected_route: str | None = Field(
        default=None,
        description="Name of the subagent that should handle this. None = the current agent should handle it directly.",
    )
    expected_tools: list[ExpectedToolCall] = Field(default_factory=list)
    expected_skills: list[str] = Field(
        default_factory=list,
        description="Names of skills that should be loaded during handling.",
    )
    forbidden_tools: list[str] = Field(
        default_factory=list,
        description="Tool names that must NOT be called for this case.",
    )
    judge_criteria: str | None = Field(
        default=None,
        description="Freeform criteria for the LLM-judge to score whether loaded skills' guidance was followed.",
    )
    default_mock: Any = Field(
        default="ok",
        description="Fallback mock response for tool calls without a per-call mock.",
    )


class ActualToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_name: str
    args: dict[str, Any] = Field(default_factory=dict)
    turn: int


class TestResult(BaseModel):
    """The outcome of running one TestCase."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    passed: bool

    # Per-assertion outcomes ---------------------------------------------
    route_ok: bool | None = None
    actual_route: str | None = None

    tools_called: list[ActualToolCall] = Field(default_factory=list)
    tools_missing: list[str] = Field(
        default_factory=list,
        description="Expected tools that were never called.",
    )
    tools_unexpected: list[str] = Field(
        default_factory=list,
        description="Tools called that were neither expected nor allowed.",
    )
    forbidden_tools_hit: list[str] = Field(default_factory=list)

    skills_loaded: list[str] = Field(default_factory=list)
    skills_missing: list[str] = Field(default_factory=list)

    skill_usage_score: float | None = Field(
        default=None,
        description="0.0–1.0 from the LLM judge; None if no criteria supplied.",
    )
    skill_usage_reason: str | None = None

    transcript: str = Field(
        default="",
        description="Human-readable summary of what the agent said and did.",
    )
    error: str | None = Field(
        default=None,
        description="Populated if the harness itself errored (as opposed to an assertion failure).",
    )
