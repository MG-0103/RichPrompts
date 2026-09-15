"""Per-test in-memory result cache.

Keyed by a content hash over everything a test result depends on:
prompt, sorted tool set, sorted skill set, the test itself, and the
config that governs sampling. Restarting the sidecar clears it —
that's fine for phase 12; IndexedDB / disk persistence lands in a
later phase alongside the storage-migration backlog item.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from threading import Lock

from .schemas import RegistryEntry, TestCase, TestResult, TestRunConfig


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def key_for(
    prompt: str,
    tools: list[RegistryEntry],
    skills: list[RegistryEntry],
    test: TestCase,
    config: TestRunConfig,
    stripped: bool,
) -> str:
    """Cache key for one pass.

    `stripped` axis is part of the key so a full-descriptions run
    and a stripped-descriptions run cache separately and each is
    reusable across ablation-on vs. ablation-off requests. The
    `ablation` flag itself is deliberately excluded — it only
    controls whether to *also* run the stripped pass.
    """
    payload = {
        "p": prompt,
        "t": sorted([{"id": t.id, "raw": t.raw} for t in tools], key=lambda x: x["id"]),
        "s": sorted([{"id": s.id, "raw": s.raw} for s in skills], key=lambda x: x["id"]),
        "tc": test.model_dump(),
        "cfg": {
            "model": config.model,
            "rollouts": config.rollouts,
            "temperature": config.temperature,
            "mock": config.mock,
        },
        "stripped": stripped,
    }
    return hashlib.sha256(_canonical(payload).encode()).hexdigest()


@dataclass
class Entry:
    result: TestResult
    stored_at: float


class ResultCache:
    """Bounded LRU-ish cache. Small: we only need enough to make
    re-runs on unchanged docs feel instant."""

    def __init__(self, max_entries: int = 512):
        self._store: dict[str, Entry] = {}
        self._lock = Lock()
        self._max = max_entries

    def get(self, k: str) -> TestResult | None:
        with self._lock:
            e = self._store.get(k)
            if e is None:
                return None
            # Return a copy with cached=True so callers can label it.
            out = e.result.model_copy(update={"cached": True})
            return out

    def put(self, k: str, r: TestResult) -> None:
        with self._lock:
            if len(self._store) >= self._max:
                # Evict the oldest entry.
                oldest = min(self._store.items(), key=lambda kv: kv[1].stored_at)[0]
                self._store.pop(oldest, None)
            self._store[k] = Entry(result=r, stored_at=time.time())

    def clear(self) -> int:
        with self._lock:
            n = len(self._store)
            self._store.clear()
            return n

    def size(self) -> int:
        with self._lock:
            return len(self._store)


CACHE = ResultCache()
