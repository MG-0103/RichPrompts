"""Behavioral testing pipeline.

Two public entry points:

- `generate_test_cases(agent, ...)` — auto-generate a starter set of
  TestCases from the AgentSpec so the user isn't writing them cold.

- `run_tests(agent, cases, ...)` — shadow-execute each case, comparing
  what the agent actually did against the case's assertions.
"""

from __future__ import annotations

from refine.testing.generator import generate_test_cases
from refine.testing.shadow import run_tests

__all__ = ["generate_test_cases", "run_tests"]
