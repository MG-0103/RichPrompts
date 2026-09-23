"""Tests for atomize's offset-resolution logic. Live LLM eval against
the corpus lives in the TS eval harness."""

from __future__ import annotations

from app.atomize import resolve_offsets, ATOM_KINDS


def test_resolve_offsets_walks_forward():
    para = "Always cite sources. Never fabricate results. Be concise."
    atoms = [
        {"text": "Always cite sources", "kind": "imperative"},
        {"text": "Never fabricate results", "kind": "imperative"},
        {"text": "Be concise", "kind": "imperative"},
    ]
    resolved, warnings = resolve_offsets(para, atoms)
    assert warnings == []
    assert len(resolved) == 3
    for r in resolved:
        assert para[r["startOffset"]:r["endOffset"]] == r["text"]
    # Ensure walk order — atom 1 must start after atom 0 ends.
    assert resolved[0]["endOffset"] <= resolved[1]["startOffset"]
    assert resolved[1]["endOffset"] <= resolved[2]["startOffset"]


def test_resolve_offsets_drops_non_verbatim():
    para = "Always cite sources. Never fabricate."
    atoms = [
        {"text": "Always cite sources", "kind": "imperative"},
        {"text": "Do not fabricate", "kind": "imperative"},  # paraphrase
    ]
    resolved, warnings = resolve_offsets(para, atoms)
    assert len(resolved) == 1
    assert resolved[0]["text"] == "Always cite sources"
    assert len(warnings) == 1
    assert "not a verbatim substring" in warnings[0]


def test_resolve_offsets_out_of_order_falls_back_to_search_from_start():
    """LLM emitted atoms in the wrong order — we still find them."""
    para = "First atom here. Second atom follows here."
    atoms = [
        {"text": "Second atom follows here", "kind": "imperative"},
        {"text": "First atom here", "kind": "imperative"},
    ]
    resolved, warnings = resolve_offsets(para, atoms)
    assert len(resolved) == 2
    assert resolved[0]["text"] == "Second atom follows here"
    # Second lookup started from cursor past first, missed "First
    # atom here" going forward, fell back to search from 0.
    assert resolved[1]["text"] == "First atom here"


def test_resolve_offsets_invalid_kind_defaults_to_imperative():
    para = "Do X."
    atoms = [{"text": "Do X", "kind": "spooky-nonsense"}]
    resolved, _ = resolve_offsets(para, atoms)
    assert resolved[0]["kind"] == "imperative"


def test_resolve_offsets_all_valid_kinds_pass_through():
    para = "A. B. C. D."
    atoms = [
        {"text": "A", "kind": "imperative"},
        {"text": "B", "kind": "declarative"},
        {"text": "C", "kind": "conditional"},
        {"text": "D", "kind": "example"},
    ]
    resolved, _ = resolve_offsets(para, atoms)
    # A is 1 char, might be dropped as too short? No — resolve_offsets
    # doesn't filter length. But single-char atoms are unlikely in
    # practice.
    assert {r["kind"] for r in resolved} == ATOM_KINDS


def test_resolve_offsets_handles_empty_text():
    para = "Some text."
    atoms = [
        {"text": "", "kind": "imperative"},
        {"text": "Some text", "kind": "imperative"},
    ]
    resolved, warnings = resolve_offsets(para, atoms)
    assert len(resolved) == 1
    assert warnings[0].startswith("atom[0]: empty text")


def test_resolve_offsets_identical_atoms_still_walks_forward():
    """When an atom text appears TWICE in the paragraph, the second
    occurrence resolves to the second position."""
    para = "Always cite sources. Never fabricate. Always cite sources."
    atoms = [
        {"text": "Always cite sources", "kind": "imperative"},
        {"text": "Never fabricate", "kind": "imperative"},
        {"text": "Always cite sources", "kind": "imperative"},
    ]
    resolved, _ = resolve_offsets(para, atoms)
    assert len(resolved) == 3
    # Third atom must start AFTER the second atom's end offset.
    assert resolved[2]["startOffset"] > resolved[1]["endOffset"]


def test_resolve_offsets_returns_valid_bounds():
    para = "First atom. Second atom."
    atoms = [
        {"text": "First atom", "kind": "imperative"},
        {"text": "Second atom", "kind": "imperative"},
    ]
    resolved, _ = resolve_offsets(para, atoms)
    for r in resolved:
        assert 0 <= r["startOffset"] < r["endOffset"] <= len(para)
