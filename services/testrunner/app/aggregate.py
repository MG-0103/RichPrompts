"""Post-rollout aggregation shared by mock and real runners.

Given the raw list of rollouts for one test, produce the summarized
`TestResult`: pass rate, concentration (modal-choice fraction), modal
call, mean steps, p50 latency, and the composite RoutingScore.
"""

from __future__ import annotations

from collections import Counter
from statistics import median

from .schemas import CalledTarget, RolloutOutcome, TestCase, TestResult


def judge_pass(test: TestCase, outcome: RolloutOutcome) -> bool:
    if outcome.error or outcome.called is None:
        return False
    called = outcome.called
    exp = test.expect
    if exp.kind == "none":
        return called.kind == "none"
    if called.kind != exp.kind or called.name != getattr(exp, "name", None):
        return False
    if test.mustNotCall and called.name and called.name in test.mustNotCall:
        return False
    return True


def _call_key(c: CalledTarget | None) -> str | None:
    if c is None:
        return None
    if c.kind == "none":
        return "none"
    return f"{c.kind}:{c.name}"


def _decode_key(k: str) -> CalledTarget:
    if k == "none":
        return CalledTarget(kind="none")
    kind, _, name = k.partition(":")
    return CalledTarget(kind=kind, name=name)  # type: ignore[arg-type]


def aggregate(
    test: TestCase,
    outcomes: list[RolloutOutcome],
    mock: bool = False,
    cached: bool = False,
) -> TestResult:
    n = len(outcomes)
    passes = [judge_pass(test, o) for o in outcomes]
    pass_rate = sum(passes) / n if n else 0.0

    keys = [_call_key(o.called) for o in outcomes if o.called is not None]
    if keys:
        counts = Counter(keys)
        top_key, top_count = counts.most_common(1)[0]
        # Concentration: if multiple keys tie at the top, penalize modestly.
        top_at_max = [k for k, c in counts.items() if c == top_count]
        concentration = (top_count / len(keys)) * (1.0 / len(top_at_max))
        modal = _decode_key(top_key) if len(top_at_max) == 1 else None
    else:
        concentration = 0.0
        modal = None

    logprobs = [o.logprob for o in outcomes if o.logprob is not None]
    mean_logprob = sum(logprobs) / len(logprobs) if logprobs else None
    mean_steps = sum(o.steps for o in outcomes) / n if n else 0.0
    latency_p50 = median(o.latencyMs for o in outcomes) if n else 0.0

    # RoutingScore composite: 70% correctness, 30% confidence-proxy.
    # Prefer measured logprob when we have it (phase-12.x reranking probe),
    # otherwise fall back to concentration.
    if mean_logprob is not None:
        # e^logprob ∈ [0,1] approximates a probability
        conf = 2.71828 ** mean_logprob
    else:
        conf = concentration
    routing_score = 0.7 * pass_rate + 0.3 * max(0.0, min(1.0, conf))

    return TestResult(
        testId=test.id,
        passRate=pass_rate,
        concentration=concentration,
        modalCalled=modal,
        meanLogprob=mean_logprob,
        meanSteps=mean_steps,
        latencyP50=latency_p50,
        routingScore=routing_score,
        rollouts=outcomes,
        cached=cached,
        mock=mock,
    )
