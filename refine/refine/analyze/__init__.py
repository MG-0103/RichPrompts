"""Analysis pipelines — static (deterministic) and LLM-based.

The top-level `analyze()` runs both stages and returns a combined
`AnalysisReport`. Callers that want just one stage can import the
sub-modules directly.
"""

from __future__ import annotations

from refine.analyze.llm import analyze_with_llm
from refine.analyze.static import run_static_lints
from refine.models import AgentSpec, AnalysisReport


def analyze(
    agent: AgentSpec,
    *,
    use_llm: bool = True,
    model: str = "claude-opus-5",
) -> AnalysisReport:
    """Run the full analysis pipeline on an agent.

    `use_llm=False` skips the Anthropic call entirely — useful in CI where
    the static lints alone give you a fast gate.
    """
    static_findings = run_static_lints(agent)

    llm_findings = []
    suggested_prompt = None
    if use_llm:
        llm_findings, suggested_prompt = analyze_with_llm(agent, model=model)

    return AnalysisReport(
        agent_name=agent.name,
        static_findings=static_findings,
        llm_findings=llm_findings,
        suggested_prompt=suggested_prompt,
    )


__all__ = ["analyze", "run_static_lints", "analyze_with_llm"]
