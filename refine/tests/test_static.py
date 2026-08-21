"""Static analyzer tests — deterministic, no network."""

from pathlib import Path

import pytest

from refine.analyze.static import run_static_lints
from refine.models import AgentSpec, SkillSpec, SubagentRef, ToolSpec


EXAMPLE = Path(__file__).parent.parent / "examples" / "support_router.yaml"


@pytest.fixture
def support_router() -> AgentSpec:
    return AgentSpec.from_yaml(EXAMPLE)


def _has(findings, category: str) -> bool:
    return any(f.category == category for f in findings)


def test_finds_orphan_tool(support_router):
    findings = run_static_lints(support_router)
    # escalate_to_slack is never mentioned in the prompt
    assert _has(findings, "orphan-tool")


def test_finds_duplicate_authority(support_router):
    findings = run_static_lints(support_router)
    # billing_agent and payments_agent have basically the same description
    assert _has(findings, "duplicate-authority")


def test_finds_under_specified_trigger(support_router):
    findings = run_static_lints(support_router)
    # "when appropriate" appears in the prompt
    assert _has(findings, "under-specified-trigger")


def test_finds_critical_must_inflation(support_router):
    findings = run_static_lints(support_router)
    assert _has(findings, "critical-must-inflation")


def test_clean_agent_produces_no_findings():
    agent = AgentSpec(
        name="clean_agent",
        system_prompt=(
            "You are a translation assistant. When the user sends text, "
            "call translate(text, target_lang) with their chosen language. "
            "If they haven't stated a language, ask which language they want. "
            "Reply with only the translated text."
        ),
        tools=[
            ToolSpec(
                name="translate",
                description="Translate `text` into `target_lang`. Returns the translated string.",
                parameters={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "target_lang": {"type": "string"},
                    },
                    "required": ["text", "target_lang"],
                },
            )
        ],
    )
    findings = run_static_lints(agent)
    # Should be quiet — no orphan tools, no CRITICAL/MUST, no vague triggers.
    for f in findings:
        assert f.category not in {
            "orphan-tool",
            "duplicate-authority",
            "under-specified-trigger",
            "critical-must-inflation",
            "negative-only-instructions",
        }
