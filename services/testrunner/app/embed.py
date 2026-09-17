"""OpenAI embeddings via direct REST — no SDK dep, minimal surface.

Serves the `/embed` endpoint. The web app calls this only when the user
hits "Deep analyze" in the Structure panel, so throughput is low and
latency needs are relaxed.

Design notes:
- We call `https://api.openai.com/v1/embeddings` with a batch of texts.
  OpenAI accepts up to 2048 inputs per call; we cap lower.
- Each individual text is capped at MAX_CHARS_PER_TEXT to avoid
  runaway costs on pathological input (a paragraph might have leaked
  a whole file).
- A sha256(text + model) → vector cache lives in-process. Restarting
  the sidecar loses the cache; that's acceptable — the web app has
  its own client-side cache keyed the same way, and the OpenAI API
  is idempotent for the same input.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from threading import Lock

import httpx

DEFAULT_MODEL = "text-embedding-3-small"
MAX_BATCH = 128
MAX_CHARS_PER_TEXT = 8000  # ~2000 tokens; well within model input limits
OPENAI_URL = "https://api.openai.com/v1/embeddings"
REQUEST_TIMEOUT_S = 30.0


def is_available() -> tuple[bool, str | None]:
    """Return (ready, reason_if_not)."""
    if not os.environ.get("OPENAI_API_KEY"):
        return False, "OPENAI_API_KEY not set"
    return True, None


def _cache_key(text: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\0")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


class VectorCache:
    """Bounded in-memory cache for embedding vectors."""

    def __init__(self, max_entries: int = 4096):
        self._store: dict[str, list[float]] = {}
        self._lock = Lock()
        self._max = max_entries

    def get(self, key: str) -> list[float] | None:
        with self._lock:
            return self._store.get(key)

    def put(self, key: str, vec: list[float]) -> None:
        with self._lock:
            if len(self._store) >= self._max:
                # Drop an arbitrary entry — bounded, not LRU. Good enough
                # for a session-scoped cache; the web-side client cache
                # is the primary one for cross-session reuse.
                self._store.pop(next(iter(self._store)))
            self._store[key] = vec

    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def clear(self) -> int:
        with self._lock:
            n = len(self._store)
            self._store.clear()
            return n


CACHE = VectorCache()


class EmbedError(Exception):
    """Non-fatal embedding failure — surfaces to the client as 502/503."""


async def _post_batch(
    client: httpx.AsyncClient,
    texts: list[str],
    model: str,
    api_key: str,
) -> list[list[float]]:
    r = await client.post(
        OPENAI_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"model": model, "input": texts, "encoding_format": "float"},
        timeout=REQUEST_TIMEOUT_S,
    )
    if r.status_code != 200:
        raise EmbedError(f"OpenAI {r.status_code}: {r.text[:400]}")
    data = r.json()
    if "data" not in data or len(data["data"]) != len(texts):
        raise EmbedError(f"OpenAI response missing data or wrong length: {str(data)[:400]}")
    # Sort by index defensively — the API guarantees order but we don't
    # want to rely on that if a client wraps or proxies the call.
    return [item["embedding"] for item in sorted(data["data"], key=lambda d: d["index"])]


async def embed_batch(
    texts: list[str],
    model: str | None = None,
) -> tuple[list[list[float]], int]:
    """Return (vectors_in_input_order, cached_count).

    Never raises for empty input; raises EmbedError for OpenAI failures
    and RuntimeError for missing API key.
    """
    if not texts:
        return [], 0
    ready, reason = is_available()
    if not ready:
        raise RuntimeError(f"embeddings unavailable: {reason}")

    model_name = model or DEFAULT_MODEL
    api_key = os.environ["OPENAI_API_KEY"]

    # Truncate any oversize inputs and remember their positions.
    prepared: list[str] = [t[:MAX_CHARS_PER_TEXT] for t in texts]

    # Resolve cache hits vs. misses.
    keys = [_cache_key(t, model_name) for t in prepared]
    vectors: list[list[float] | None] = [None] * len(prepared)
    miss_indices: list[int] = []
    cached_count = 0
    for i, k in enumerate(keys):
        hit = CACHE.get(k)
        if hit is not None:
            vectors[i] = hit
            cached_count += 1
        else:
            miss_indices.append(i)

    # Fetch misses in bounded batches.
    if miss_indices:
        async with httpx.AsyncClient() as client:
            for start in range(0, len(miss_indices), MAX_BATCH):
                chunk_idx = miss_indices[start:start + MAX_BATCH]
                chunk_texts = [prepared[i] for i in chunk_idx]
                fetched = await _post_batch(client, chunk_texts, model_name, api_key)
                for idx, vec in zip(chunk_idx, fetched):
                    vectors[idx] = vec
                    CACHE.put(keys[idx], vec)

    # At this point every slot is filled. Runtime-check to satisfy the type
    # narrower and to catch any partial-fill bug quickly.
    out: list[list[float]] = []
    for i, v in enumerate(vectors):
        if v is None:
            raise EmbedError(f"internal: missing vector at index {i}")
        out.append(v)
    return out, cached_count


def embed_batch_sync(
    texts: list[str],
    model: str | None = None,
) -> tuple[list[list[float]], int]:
    """Blocking wrapper used from sync FastAPI handlers."""
    return asyncio.run(embed_batch(texts, model))
