"""Tests for the YAML-driven ruleset runner."""

from pathlib import Path

import pytest
import yaml

from refine.models import AgentSpec, Severity
from refine.rules import load_rules, run_ruleset


EXAMPLE = Path(__file__).parent.parent / "examples" / "support_router.yaml"


@pytest.fixture
def support_router() -> AgentSpec:
    return AgentSpec.from_yaml(EXAMPLE)


def test_patterns_yaml_is_valid_shape():
    rules = load_rules()
    assert rules, "patterns.yaml has no rules"
    for r in rules:
        assert "id" in r
        assert "type" in r
        assert "severity" in r
        assert "message" in r
        assert "fix" in r
        assert "source" in r, f"rule {r['id']} is missing a docs source reference"
        assert r["source"].startswith(("docs/", "BEST_TECHNIQUES.md"))


def test_ruleset_produces_findings_with_docs_refs(support_router):
    findings = run_ruleset(support_router)
    assert findings, "ruleset produced no findings on the mediocre example"
    for f in findings:
        assert f.source == "static"
        assert f.docs_ref, f"finding {f.category} carries no docs_ref"
        assert f.docs_ref.startswith(("docs/", "BEST_TECHNIQUES.md"))


def test_ruleset_finds_expected_categories(support_router):
    categories = {f.category for f in run_ruleset(support_router)}
    assert "critical-must-inflation" in categories
    assert "under-specified-trigger" in categories
    assert "negative-only-instructions" in categories


def test_length_rule_fires_on_long_prompt():
    agent = AgentSpec(
        name="verbose",
        # Just past the 12,000-char threshold, all letters (no rule-like lines
        # so we don't accidentally trip instruction-stacking).
        system_prompt="a " * 6100,
    )
    findings = run_ruleset(agent)
    ids = {f.category for f in findings}
    assert "prompt-too-long" in ids


def test_regex_count_thresholds_are_respected():
    # Three CRITICALs is right at the threshold (max_hits=3) -> no finding.
    below = AgentSpec(
        name="quiet",
        system_prompt="CRITICAL do X. CRITICAL do Y. CRITICAL do Z.",
    )
    assert "critical-must-inflation" not in {f.category for f in run_ruleset(below)}

    # Four CRITICALs trips it (count > 3).
    over = AgentSpec(
        name="loud",
        system_prompt="CRITICAL a. CRITICAL b. CRITICAL c. CRITICAL d.",
    )
    assert "critical-must-inflation" in {f.category for f in run_ruleset(over)}


def test_custom_rules_file_overrides_default(tmp_path):
    # Author a one-rule custom ruleset and run it.
    custom = tmp_path / "custom.yaml"
    custom.write_text(
        yaml.safe_dump(
            {
                "rules": [
                    {
                        "id": "banned-word-foo",
                        "type": "regex_count",
                        "pattern": r"\bfoo\b",
                        "max_hits": 0,
                        "severity": "warn",
                        "category": "banned-word",
                        "message": "The word 'foo' appears {count} time(s).",
                        "fix": "Replace 'foo' with a real word.",
                        "source": "docs/local-style.md",
                    }
                ]
            }
        )
    )
    agent = AgentSpec(name="fooer", system_prompt="foo foo bar.")
    findings = run_ruleset(agent, rules_path=custom)
    assert len(findings) == 1
    assert findings[0].category == "banned-word"
    assert findings[0].severity == Severity.WARN
    assert "2 time" in findings[0].message
