"""Semantic chunker — v2 Phase 1.

Finds section boundaries in prompt regions that regex missed (unheaded
prose). Splits the region into sentences, embeds each, and marks a
boundary between consecutive sentences when their cosine similarity
drops below a threshold — a topic shift in embedding space.

Algorithm:

  1. Split the source into sentences with offsets.
  2. Compute the set of "gap regions" — spans not covered by any
     known heading/xml boundary from regex Layer 1. Only sentences in
     gap regions are candidates for semantic boundaries. This is
     critical: regex is precise about the boundaries it does find, so
     we let it own those spans and only augment.
  3. Embed each gap sentence via existing /embed path.
  4. For each pair of consecutive gap sentences, compute cosine
     similarity. If the pair spans a heading boundary (i.e. they're
     not actually consecutive in the source), skip.
  5. Emit a boundary at the start of the later sentence when
     similarity < threshold. Merge adjacent boundaries closer than
     `min_gap_chars` to avoid over-splitting.

Threshold tuning is corpus-driven — see scripts/eval-v2-segment.ts.
Default 0.65 is a conservative start; real value is decided by the
gate in PIPELINE_V2_PLAN.md phase 1.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Iterable

from .embed import embed_batch


DEFAULT_THRESHOLD = 0.65
DEFAULT_MIN_GAP_CHARS = 150
MIN_SENTENCE_CHARS = 10

# Sentence boundary: end-of-sentence punctuation followed by whitespace,
# or a blank-line gap. Kept intentionally simple — for prompts, a
# heavier NLP splitter (spaCy) is overkill.
_SENTENCE_BOUNDARY_RE = re.compile(r"(?:(?<=[.!?])\s+)|(?:\n{2,})")


@dataclass
class Sentence:
    start: int
    end: int
    text: str
    embedding: list[float] | None = None


@dataclass
class SegmentDebug:
    """Debug info returned alongside boundaries — helps threshold
    tuning without a separate endpoint."""
    sentence_offsets: list[tuple[int, int]] = field(default_factory=list)
    pair_similarities: list[dict] = field(default_factory=list)
    gap_regions: list[tuple[int, int]] = field(default_factory=list)


def split_sentences(text: str) -> list[Sentence]:
    """Return sentences with their offset ranges in `text`. Drops
    whitespace-only and too-short (< MIN_SENTENCE_CHARS) fragments."""
    out: list[Sentence] = []
    cursor = 0
    for m in _SENTENCE_BOUNDARY_RE.finditer(text):
        end = m.start()
        raw = text[cursor:end]
        stripped = raw.strip()
        if stripped and len(stripped) >= MIN_SENTENCE_CHARS:
            # Preserve the trimmed offsets — the raw slice may include
            # leading whitespace we don't want to include.
            lead = len(raw) - len(raw.lstrip())
            trail = len(raw) - len(raw.rstrip())
            out.append(Sentence(
                start=cursor + lead,
                end=end - trail,
                text=stripped,
            ))
        cursor = m.end()
    # Tail after the last boundary
    tail = text[cursor:]
    stripped = tail.strip()
    if stripped and len(stripped) >= MIN_SENTENCE_CHARS:
        lead = len(tail) - len(tail.lstrip())
        trail = len(tail) - len(tail.rstrip())
        out.append(Sentence(
            start=cursor + lead,
            end=len(text) - trail,
            text=stripped,
        ))
    return out


def compute_gap_regions(
    length: int,
    known_boundaries: list[int],
) -> list[tuple[int, int]]:
    """Turn a set of known boundary offsets into the covered-vs-gap
    partition of the source. A "gap" is a span not covered by any
    named boundary; that's where the semantic chunker gets to run.

    known_boundaries are section-start offsets (inclusive). We treat
    them as separators: the region [b_i, b_{i+1}) is one section, so
    inside that region the semantic chunker may propose additional
    boundaries. Regions of length < a couple of sentences aren't worth
    running the chunker on.
    """
    if not known_boundaries:
        return [(0, length)]
    bounds = sorted(set(known_boundaries + [length]))
    if bounds[0] > 0:
        bounds = [0] + bounds
    gaps: list[tuple[int, int]] = []
    for i in range(len(bounds) - 1):
        start, end = bounds[i], bounds[i + 1]
        if end > start:
            gaps.append((start, end))
    return gaps


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        x = a[i]
        y = b[i]
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


async def segment(
    source: str,
    known_boundaries: list[int],
    threshold: float = DEFAULT_THRESHOLD,
    min_gap_chars: int = DEFAULT_MIN_GAP_CHARS,
    model: str | None = None,
) -> tuple[list[int], SegmentDebug]:
    """Return (new_boundaries, debug)."""
    debug = SegmentDebug()
    gaps = compute_gap_regions(len(source), known_boundaries)
    debug.gap_regions = gaps
    if not gaps:
        return [], debug

    sentences = split_sentences(source)
    debug.sentence_offsets = [(s.start, s.end) for s in sentences]
    if len(sentences) < 2:
        return [], debug

    # Group sentences by gap region — only sentences fully inside the
    # SAME gap can produce a cross-sentence boundary within that gap.
    per_gap: list[list[Sentence]] = [[] for _ in gaps]
    for s in sentences:
        for i, (gs, ge) in enumerate(gaps):
            if s.start >= gs and s.end <= ge:
                per_gap[i].append(s)
                break

    # Collect the sentences we need to embed — only those in gaps with
    # >= 2 sentences (a lone sentence in a gap has no pair).
    to_embed: list[Sentence] = []
    for group in per_gap:
        if len(group) >= 2:
            to_embed.extend(group)
    if not to_embed:
        return [], debug

    vectors, _cached = await embed_batch([s.text for s in to_embed], model=model)
    for s, vec in zip(to_embed, vectors):
        s.embedding = vec

    # Scan for boundaries within each gap independently.
    new_boundaries: list[int] = []
    for gi, group in enumerate(per_gap):
        if len(group) < 2:
            continue
        for i in range(len(group) - 1):
            a, b = group[i], group[i + 1]
            if a.embedding is None or b.embedding is None:
                continue
            sim = cosine(a.embedding, b.embedding)
            debug.pair_similarities.append({
                "gap": gi,
                "left_range": [a.start, a.end],
                "right_range": [b.start, b.end],
                "similarity": sim,
            })
            if sim < threshold:
                # Boundary at the start of the later sentence.
                new_boundaries.append(b.start)

    # De-dup and merge boundaries closer than min_gap_chars.
    new_boundaries.sort()
    merged: list[int] = []
    for offset in new_boundaries:
        if merged and offset - merged[-1] < min_gap_chars:
            continue
        merged.append(offset)
    return merged, debug
