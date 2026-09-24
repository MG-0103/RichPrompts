"""Tests for classify_v2 — pure normalization logic. Live LLM eval
against the corpus lives in the TS eval harness."""

from __future__ import annotations

from app.classify_v2 import _normalize, AMBIGUOUS_GAP


def test_normalize_valid_response():
    parsed = {
        "family": "textual",
        "label": "task",
        "confidence": 0.85,
        "alternatives": [
            {"label": "role", "confidence": 0.08},
            {"label": "output", "confidence": 0.04},
        ],
        "reasoning": "Direct imperative on what to do.",
    }
    r = _normalize(parsed)
    assert r["family"] == "textual"
    assert r["label"] == "task"
    assert r["confidence"] == 0.85
    assert len(r["alternatives"]) == 2
    assert r["alternatives"][0]["label"] == "role"
    assert r["ambiguous"] is False  # 0.85 - 0.08 = 0.77 >> 0.1


def test_normalize_ambiguous_when_top2_are_close():
    parsed = {
        "family": "textual",
        "label": "constraints",
        "confidence": 0.55,
        "alternatives": [
            {"label": "output", "confidence": 0.50},
            {"label": "guardrails", "confidence": 0.10},
        ],
    }
    r = _normalize(parsed)
    assert r["ambiguous"] is True  # 0.55 - 0.50 = 0.05 < 0.1


def test_normalize_pads_alternatives_when_missing():
    parsed = {"family": "textual", "label": "role", "confidence": 0.9}
    r = _normalize(parsed)
    assert len(r["alternatives"]) == 2


def test_normalize_family_tool_forces_label_to_family():
    parsed = {
        "family": "tool",
        "label": "task",   # LLM confused, but family=tool means label=tool
        "confidence": 0.8,
    }
    r = _normalize(parsed)
    assert r["family"] == "tool"
    assert r["label"] == "tool"


def test_normalize_clips_confidence_out_of_range():
    parsed = {"family": "textual", "label": "task", "confidence": 1.7}
    r = _normalize(parsed)
    assert r["confidence"] == 1.0
    parsed = {"family": "textual", "label": "task", "confidence": -0.4}
    r = _normalize(parsed)
    assert r["confidence"] == 0.0


def test_normalize_invalid_family_falls_back():
    parsed = {"family": "nonsense", "label": "task", "confidence": 0.6}
    r = _normalize(parsed)
    assert r["family"] == "textual"


def test_normalize_invalid_textual_label_falls_back():
    parsed = {"family": "textual", "label": "nonsense", "confidence": 0.6}
    r = _normalize(parsed)
    assert r["label"] == "task"


def test_normalize_reasoning_truncated():
    parsed = {
        "family": "textual",
        "label": "task",
        "confidence": 0.5,
        "reasoning": "x" * 500,
    }
    r = _normalize(parsed)
    assert len(r["reasoning"]) == 200


def test_normalize_not_ambiguous_when_gap_clearly_exceeds():
    """When the confidence gap is clearly larger than the threshold,
    the chunk is unambiguous. Use a gap comfortably above
    AMBIGUOUS_GAP (0.25) so this test survives future gap tweaks."""
    parsed = {
        "family": "textual",
        "label": "task",
        "confidence": 0.90,
        "alternatives": [
            {"label": "role", "confidence": 0.05},
        ],
    }
    r = _normalize(parsed)
    # Gap is 0.85 — well above AMBIGUOUS_GAP.
    assert r["ambiguous"] is False
