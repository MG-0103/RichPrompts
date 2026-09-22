"""Tests for the semantic chunker's pure algorithm — sentence
splitting, gap-region computation, cosine, and boundary emission
under injected (mock) embeddings. Real /v2/segment eval against the
corpus needs OPENAI_API_KEY and lives in the TS eval harness.

Run:  cd services/testrunner && python -m pytest tests/
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from app.segment import (
    compute_gap_regions,
    cosine,
    segment,
    split_sentences,
)


# --------- Sentence splitting ---------

def test_split_sentences_basic():
    text = "First sentence here. Second one follows. Third and last."
    sents = split_sentences(text)
    assert len(sents) == 3
    assert text[sents[0].start:sents[0].end] == "First sentence here."
    assert text[sents[1].start:sents[1].end] == "Second one follows."
    assert text[sents[2].start:sents[2].end] == "Third and last."


def test_split_sentences_paragraph_break():
    text = "Paragraph one.\n\nParagraph two starts here."
    sents = split_sentences(text)
    assert len(sents) == 2
    assert sents[0].text == "Paragraph one."
    assert sents[1].text == "Paragraph two starts here."


def test_split_sentences_drops_short_fragments():
    text = "Ok! Ok! A real sentence follows here now."
    sents = split_sentences(text)
    # "Ok!" and "Ok!" are under MIN_SENTENCE_CHARS.
    assert len(sents) == 1
    assert sents[0].text == "A real sentence follows here now."


def test_split_sentences_offsets_preserve_stripping():
    text = "  Leading whitespace here.  Trailing after this.  "
    sents = split_sentences(text)
    # Offsets should point at the trimmed text
    for s in sents:
        assert text[s.start:s.end].strip() == text[s.start:s.end]


# --------- Gap region computation ---------

def test_compute_gap_regions_no_boundaries():
    assert compute_gap_regions(100, []) == [(0, 100)]


def test_compute_gap_regions_partitions_source():
    # Boundaries at 0, 50, 100 → two regions [0,50), [50,100).
    assert compute_gap_regions(100, [0, 50]) == [(0, 50), (50, 100)]


def test_compute_gap_regions_prepends_zero():
    # Boundaries missing a 0 → prepend automatically.
    assert compute_gap_regions(100, [30, 60]) == [(0, 30), (30, 60), (60, 100)]


def test_compute_gap_regions_dedups_and_sorts():
    assert compute_gap_regions(100, [60, 30, 30, 60]) == [(0, 30), (30, 60), (60, 100)]


# --------- Cosine ---------

def test_cosine_identical_vectors():
    assert cosine([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == pytest.approx(1.0)


def test_cosine_orthogonal_vectors():
    assert cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_opposite_vectors():
    assert cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_zero_magnitude_returns_zero():
    assert cosine([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert cosine([], [1.0]) == 0.0


# --------- Segment (mocked embeddings) ---------

async def _fake_embed(texts, model=None):
    """Assign vectors so consecutive sentences drop similarity at
    predictable positions."""
    vectors = []
    for t in texts:
        # A vector that switches direction based on a marker in the text
        if "TOPIC_A" in t:
            vectors.append([1.0, 0.0, 0.0])
        elif "TOPIC_B" in t:
            vectors.append([0.0, 1.0, 0.0])
        elif "TOPIC_C" in t:
            vectors.append([0.0, 0.0, 1.0])
        else:
            vectors.append([0.5, 0.5, 0.5])
    return vectors, 0


def test_segment_emits_boundary_at_topic_shift():
    text = (
        "This talks about TOPIC_A in detail. TOPIC_A comes up again here. "
        "But now TOPIC_B changes the subject. TOPIC_B keeps going in this line."
    )
    with patch("app.segment.embed_batch", side_effect=_fake_embed):
        boundaries, debug = asyncio.run(
            segment(text, known_boundaries=[], threshold=0.5)
        )
    # One boundary expected at the shift from TOPIC_A → TOPIC_B.
    assert len(boundaries) == 1
    assert "TOPIC_B" in text[boundaries[0]:boundaries[0] + 40]


def test_segment_respects_known_boundaries():
    # Two regions from regex: [0, 60) and [60, EOF). Semantic chunker
    # should NOT emit a boundary at the regex-known split (60), only
    # WITHIN each gap if content shifts.
    text = (
        "TOPIC_A first sentence here in region one. "
        "TOPIC_A second sentence also region one. "  # ~85
        "TOPIC_B first sentence in region two. "
        "TOPIC_B second sentence in region two."
    )
    with patch("app.segment.embed_batch", side_effect=_fake_embed):
        boundaries, _ = asyncio.run(
            segment(text, known_boundaries=[0, 85], threshold=0.5)
        )
    # No shift within either gap → no new boundaries.
    assert boundaries == []


def test_segment_no_boundary_when_similar_throughout():
    text = "TOPIC_A first. TOPIC_A second. TOPIC_A third. TOPIC_A fourth."
    with patch("app.segment.embed_batch", side_effect=_fake_embed):
        boundaries, _ = asyncio.run(
            segment(text, known_boundaries=[], threshold=0.5)
        )
    assert boundaries == []


def test_segment_merges_close_boundaries():
    # Two shifts very close together — should merge to one.
    text = (
        "TOPIC_A stuff first. TOPIC_B shift here! TOPIC_C shift again? "
        "TOPIC_C keeps going with more content."
    )
    with patch("app.segment.embed_batch", side_effect=_fake_embed):
        boundaries, _ = asyncio.run(
            segment(text, known_boundaries=[], threshold=0.5, min_gap_chars=200)
        )
    # min_gap_chars=200 forces merge; expect at most 1 boundary.
    assert len(boundaries) <= 1
