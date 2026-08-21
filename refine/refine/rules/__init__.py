"""Data-driven ruleset for the static analyzer.

Regex-shaped and threshold-shaped rules live as YAML data in
`patterns.yaml`; graph-shaped checks (cross-referencing tools, walking
subagent lists, similarity ratios) stay in `refine/analyze/static.py` as
plain Python — they don't compress into data cleanly.

Adding a new pattern rule = adding an entry to `patterns.yaml`.
Adding a new graph rule = adding a function to `static.py` and listing
it in the `CHECKS` array there.

Each YAML rule cites the docs section that grounds it, so every static
finding is traceable back to the research it comes from.
"""

from __future__ import annotations

import re
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from refine.models import AgentSpec, Finding, Severity


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_ruleset(
    agent: AgentSpec,
    *,
    rules_path: Path | None = None,
) -> list[Finding]:
    """Load `patterns.yaml` (or a caller-supplied path) and run every rule."""
    rules = _load_rules(rules_path)
    findings: list[Finding] = []
    for rule in rules:
        finding = _run_rule(rule, agent)
        if finding is not None:
            findings.append(finding)
    return findings


def load_rules(rules_path: Path | None = None) -> list[dict]:
    """Public inspector — useful for tests and for the eventual UI."""
    return _load_rules(rules_path)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _load_rules(rules_path: Path | None) -> list[dict]:
    if rules_path is not None:
        with open(rules_path) as f:
            data = yaml.safe_load(f) or {}
    else:
        # Read the packaged patterns.yaml from within this subpackage.
        text = resources.files(__package__).joinpath("patterns.yaml").read_text(
            encoding="utf-8"
        )
        data = yaml.safe_load(text) or {}
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        raise ValueError("patterns.yaml: top-level `rules` must be a list.")
    return rules


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


def _run_rule(rule: dict[str, Any], agent: AgentSpec) -> Finding | None:
    kind = rule.get("type")
    handler = _HANDLERS.get(kind)
    if handler is None:
        raise ValueError(
            f"Unknown rule type {kind!r} on rule id={rule.get('id')!r}. "
            f"Known types: {sorted(_HANDLERS)}"
        )
    return handler(rule, agent)


# ---------------------------------------------------------------------------
# Rule handlers
# ---------------------------------------------------------------------------


def _handle_length(rule: dict, agent: AgentSpec) -> Finding | None:
    """Fires when `len(system_prompt) > max_chars`."""
    max_chars = int(rule["max_chars"])
    n = len(agent.system_prompt)
    if n <= max_chars:
        return None
    return _finding(rule, count=n, max_chars=max_chars)


def _handle_regex_count(rule: dict, agent: AgentSpec) -> Finding | None:
    """Fires when `pattern` matches more than `max_hits` times anywhere in the prompt."""
    pattern = re.compile(rule["pattern"], _resolve_flags(rule.get("flags")))
    hits = pattern.findall(agent.system_prompt)
    count = len(hits)
    if count <= int(rule.get("max_hits", 0)):
        return None
    return _finding(rule, count=count, max_hits=rule.get("max_hits"))


def _handle_line_regex_count(rule: dict, agent: AgentSpec) -> Finding | None:
    """Fires when `pattern` matches at line-start on more than `max_hits` lines."""
    pattern = re.compile(rule["pattern"], _resolve_flags(rule.get("flags")))
    strip_bullet = bool(rule.get("strip_bullet", False))
    count = 0
    for line in agent.system_prompt.splitlines():
        text = line.strip("-*+ \t") if strip_bullet else line
        if pattern.match(text):
            count += 1
    if count <= int(rule.get("max_hits", 0)):
        return None
    return _finding(rule, count=count, max_hits=rule.get("max_hits"))


_HANDLERS = {
    "length": _handle_length,
    "regex_count": _handle_regex_count,
    "line_regex_count": _handle_line_regex_count,
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


_FLAG_MAP = {
    "ignorecase": re.IGNORECASE,
    "multiline": re.MULTILINE,
    "dotall": re.DOTALL,
}


def _resolve_flags(flags: list[str] | None) -> int:
    if not flags:
        return 0
    out = 0
    for f in flags:
        key = f.lower()
        if key not in _FLAG_MAP:
            raise ValueError(f"Unknown regex flag: {f!r}")
        out |= _FLAG_MAP[key]
    return out


def _finding(rule: dict, **fmt: object) -> Finding:
    return Finding(
        severity=Severity(rule.get("severity", "info")),
        category=rule.get("category", rule["id"]),
        message=rule["message"].format(**fmt),
        suggestion=rule["fix"],
        location=rule.get("location", "system_prompt"),
        source="static",
        docs_ref=rule.get("source"),
    )


__all__ = ["run_ruleset", "load_rules"]
