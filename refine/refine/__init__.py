"""refine — Analyze and behaviorally test multi-agent system definitions.

Public API:

    from refine import (
        AgentSpec, ToolSpec, SkillSpec, SubagentRef,
        TestCase, ExpectedToolCall,
        analyze, run_tests, generate_test_cases,
    )
"""

from refine.models import (
    AgentSpec,
    AnalysisReport,
    ExpectedToolCall,
    Finding,
    Severity,
    SkillSpec,
    SubagentRef,
    TestCase,
    TestResult,
    ToolSpec,
)
from refine.analyze import analyze
from refine.testing import generate_test_cases, run_tests

__all__ = [
    "AgentSpec",
    "AnalysisReport",
    "ExpectedToolCall",
    "Finding",
    "Severity",
    "SkillSpec",
    "SubagentRef",
    "TestCase",
    "TestResult",
    "ToolSpec",
    "analyze",
    "generate_test_cases",
    "run_tests",
]

__version__ = "0.1.0"
