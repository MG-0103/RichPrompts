"""Deterministic mock runner.

No LLM calls. Rollout outcomes are seeded by (test, prompt, rollout)
so re-runs match. Uses the same aggregation as the real runner, so
the UI never has to know which one produced a result.
"""

from __future__ import annotations

import hashlib
import random
import re
import time

from .aggregate import aggregate
from .schemas import (
    CalledTarget,
    RolloutOutcome,
    TestCase,
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
    # More temperature → more noise; keeps concentration signal alive.
    noise = (rng.random() - 0.5) * min(config.temperature, 1.5) * 0.5
    pick_prob = min(0.99, max(0.02, base + noise))

    if rng.random() < pick_prob and expected_kind != "none":
        called = CalledTarget(kind=expected_kind, name=expected_name)
    elif expected_kind == "none":
        called = CalledTarget(kind="none")
    else:
        called = CalledTarget(kind="none")

    return RolloutOutcome(
        called=called,
        args={},
        latencyMs=latency,
        steps=steps,
        logprob=None,
    )


def run_mock(req: TestRunRequest) -> TestRunResponse:
    started = time.perf_counter()
    config = req.config or TestRunConfig()
    rollouts_n = max(1, config.rollouts)

    results = []
    for tc in req.testCases:
        outcomes = [_run_one(tc, req.prompt, i, config) for i in range(rollouts_n)]
        results.append(aggregate(tc, outcomes, mock=True))

    duration = (time.perf_counter() - started) * 1000
    return TestRunResponse(
        results=results,
        durationMs=duration,
        sidecarVersion="0.3.0-mock",
    )
