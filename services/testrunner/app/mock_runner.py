"""Deterministic mock runner for Phase 10.

Returns believable-looking results without calling any LLM. The scoring
model here is intentionally naive: if the expected target's name appears
verbatim in the query, we say the router picked it with high confidence.
Otherwise we return a randomized-but-seeded miss. This is enough to wire
up the whole UI and prove the request/response contract before Phase 11
brings the real ADK.
"""

from __future__ import annotations

import hashlib
import random
import re
import time
from statistics import median

from .schemas import (
    CalledTarget,
    RolloutOutcome,
    TestCase,
    TestResult,
    TestRunConfig,
    TestRunRequest,
    TestRunResponse,
)


def _seed_for(test: TestCase, prompt: str, rollout: int) -> int:
    key = f"{test.id}|{test.query}|{prompt[:64]}|{rollout}".encode()
    return int(hashlib.md5(key).hexdigest()[:8], 16)


def _score_query(query: str, expected_name: str | None) -> float:
    if not expected_name:
        return 0.5
    q = query.lower()
    name = expected_name.lower()
    if name in q:
        return 0.95
    tokens = re.split(r"[^a-z0-9]+", name)
    hits = sum(1 for t in tokens if t and t in q)
    if not tokens:
        return 0.3
    return min(0.9, 0.35 + 0.15 * hits)


def _run_one(
    test: TestCase, prompt: str, rollout: int, config: TestRunConfig
) -> RolloutOutcome:
    rng = random.Random(_seed_for(test, prompt, rollout))
    latency = 40 + rng.random() * 120
    steps = rng.randint(1, 4)

    expected_kind = test.expect.kind
    expected_name = getattr(test.expect, "name", None)
    base = _score_query(test.query, expected_name)
    noise = (rng.random() - 0.5) * (1.0 - min(config.temperature, 1.0)) * 0.1
    pick_prob = min(0.99, max(0.02, base + noise))

    if rng.random() < pick_prob and expected_kind != "none":
        called = CalledTarget(kind=expected_kind, name=expected_name)
        logprob = -0.05 - (1.0 - pick_prob) * 2.0
    elif expected_kind == "none":
        called = CalledTarget(kind="none")
        logprob = -0.4
    else:
        called = CalledTarget(kind="none")
        logprob = -1.8

    return RolloutOutcome(
        called=called,
        args={},
        latencyMs=latency,
        steps=steps,
        logprob=logprob,
    )


def _judge_pass(test: TestCase, outcome: RolloutOutcome) -> bool:
    if outcome.error or outcome.called is None:
        return False
    called = outcome.called
    exp = test.expect
    if exp.kind == "none":
        return called.kind == "none"
    if called.kind != exp.kind or called.name != getattr(exp, "name", None):
        return False
    if test.mustNotCall and called.name in test.mustNotCall:
        return False
    return True


def run_mock(req: TestRunRequest) -> TestRunResponse:
    started = time.perf_counter()
    config = req.config or TestRunConfig()
    rollouts = max(1, config.rollouts)
    results: list[TestResult] = []

    for test in req.testCases:
        outcomes = [_run_one(test, req.prompt, i, config) for i in range(rollouts)]
        passes = [_judge_pass(test, o) for o in outcomes]
        pass_rate = sum(passes) / len(passes)
        logprobs = [o.logprob for o in outcomes if o.logprob is not None]
        mean_logprob = sum(logprobs) / len(logprobs) if logprobs else None
        mean_steps = sum(o.steps for o in outcomes) / len(outcomes)
        latency_p50 = median(o.latencyMs for o in outcomes)
        # RoutingScore = 0.7 * passRate + 0.3 * normalize(meanLogprob)
        # Rough normalization: exp(mean_logprob) maps to [0,1].
        conf = (2.71828 ** mean_logprob) if mean_logprob is not None else pass_rate
        routing_score = 0.7 * pass_rate + 0.3 * max(0.0, min(1.0, conf))

        results.append(
            TestResult(
                testId=test.id,
                passRate=pass_rate,
                meanLogprob=mean_logprob,
                meanSteps=mean_steps,
                latencyP50=latency_p50,
                routingScore=routing_score,
                rollouts=outcomes,
                mock=True,
            )
        )

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=results,
        durationMs=duration,
        sidecarVersion="0.1.0-mock",
    )
