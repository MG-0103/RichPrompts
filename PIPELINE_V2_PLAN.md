# Pipeline v2 — phased implementation plan

Branch: `claude/pipeline-v2-spike`
Off: `claude/codebase-status-discussion-p6f1ay`
Started: 2026-09-22

**Purpose:** test whether the staged pipeline (structure → atomize → per-section
match & score → NLI contradictions → human decisions) actually outperforms v1
before committing to a full migration. Each phase is a self-contained deliverable
with a clear "does this work?" gate — if a phase fails its gate, we stop and
rethink instead of building further on a bad foundation.

Architecture reference: [artifact](https://claude.ai/artifact/AUUrtqARj8HhQadhveyJCB)
(diagram + pros/cons + V2 API surface).

---

## Phase 0 — Ground truth & spike harness

**Goal:** without an eval set we're guessing. Build one first.

**Deliverables**
- `packages/core/src/__tests__/corpus/` — 20-30 real prompts checked in as
  `.md` files. Mix of well-structured (headings) and unstructured (wall of
  text). Include the "two agent definitions" case that broke v1.
- `packages/core/src/__tests__/corpus/labels.json` — hand-labeled expected
  outputs per prompt:
  - Section boundaries (offset ranges) with canonical labels.
  - Expected atoms per paragraph (rough; not exhaustive).
  - Known duplicate atom pairs.
  - Known contradiction atom pairs.
  - Known related-but-distinct atom pairs (the ones v1 mis-labels).
- `services/testrunner/eval/` — Python harness that runs both v1 and v2
  pipelines on each corpus prompt and diffs results against labels.
  Outputs precision/recall per finding type.

**Gate:** eval harness runs end-to-end on v1 with real precision/recall
numbers. This becomes the baseline every subsequent phase measures against.

**Effort:** ~1 day (labeling is the slow part).

---

## Phase 1 — Semantic chunking

**Goal:** find section boundaries in unheaded prose regions.

**Deliverables**
- `services/testrunner/app/segment.py` — semantic-distance chunker. Recipe:
  embed each sentence via existing `/embed` path; scan consecutive sentences
  for cosine drops below threshold; emit boundary offsets. Threshold is a
  tunable parameter reported per run.
- `POST /v2/segment` — endpoint. Input: raw text + list of already-known
  boundaries (from regex Layer 1). Output: additional boundary offsets for
  unheaded regions only.
- Tests against corpus prompts: measure boundary precision/recall vs
  labeled boundaries.

**Gate:** on the corpus, v1 (regex-only) finds N boundaries; v2 (regex +
semantic) finds N + M with per-boundary precision ≥ 80%. If precision is
below 80% we're introducing more noise than signal.

**Effort:** ~1 day.

**Status (2026-09-22):** Endpoint + segmenter shipped. Unit tests pass
(16/16) with mocked embeddings. Live corpus gate needs a running
sidecar with `OPENAI_API_KEY`; run `npm --workspace packages/core run
eval:v2-segment` against a live sidecar and record the result here.

---

## Phase 2 — Hierarchical NLI section classifier

**Goal:** replace the four-way LLM classifier with a deterministic NLI model
that's cheaper, offline, and more auditable.

**Deliverables**
- `services/testrunner/app/nli.py` — load DeBERTa-v3-base-mnli (~130 MB) via
  `transformers`. Cache the model at container start.
- Hierarchical classifier: two-level. Level 1 picks a family
  (textual instruction / tool definition / skill definition / agent
  delegation). Level 2 within textual picks
  role-family / task-family / output-family / constraints-family / meta-family.
  Level 3 within role-family picks role / persona / style / tone.
- Confidence gating: return top-3 hypotheses per level with entailment
  scores. When top-two are within 0.1, mark the chunk as "ambiguous".
- `POST /v2/classify` — endpoint. Input: text chunk. Output: `(label,
  confidence, alternatives[])` plus an `ambiguous` flag.
- Optional fallback: when ambiguous, call gpt-4o-mini once and return its
  pick alongside the NLI top-3 so the UI can show both.
- Tests: run on corpus chunks with expected labels. Measure per-family and
  per-label precision/recall.

**Gate:** NLI classifier hits ≥ 80% top-1 accuracy at family level and
≥ 65% at leaf label level on the corpus. Below that, the model isn't worth
its 130 MB and we go back to LLM classification.

**Effort:** ~1.5 days (model loading + hierarchical wiring + tests).

---

## Phase 3 — Atomization

**Goal:** decompose paragraphs into atomic instructions. The critical-path
step — if this fails, everything downstream is compromised.

**Deliverables**
- `services/testrunner/app/atomize.py` — gpt-4o-mini call per paragraph with
  strict JSON output. Prompt gives 3-4 few-shot examples showing correct
  atomization (compound sentences split into distinct atoms; conditional
  atoms preserved as single units).
- `POST /v2/atomize` — endpoint. Input: paragraph text + optional section
  label for context. Output: `atoms[]` with `text`, `startOffset`,
  `endOffset` within the paragraph, and a `kind` field
  (imperative / declarative / conditional / example).
- Server-side cache keyed by (paragraph, model). Same paragraph always
  returns same atoms.
- Tests: run on corpus paragraphs. Compare LLM output against hand-labeled
  expected atoms. Measure atom precision/recall (F1) and boundary accuracy.

**Gate:** F1 ≥ 0.75 on atom detection over the corpus. Also spot-check 5
edge cases (compound sentences, conditionals, list-bullets) with human
review — pass/fail per case.

**Effort:** ~1.5 days (mostly prompt iteration + eval).

---

## Phase 4 — Within-section match & deterministic scoring

**Goal:** replace v1's LLM verifier with a threshold-based score over atoms
in the same section.

**Deliverables**
- `packages/core/src/v2/score.ts` — deterministic scorer over atom pairs.
  Inputs: two atoms, cosine similarity, LCS length, shared-ngram count,
  same-section flag, content-overlap ratio. Output: `duplicate` /
  `consolidation` / `distinct` with a confidence score.
  Thresholds tunable via config, documented per threshold with a
  one-sentence justification.
- Neighbor search restricted to atoms sharing a canonical section (not just
  cosine-close over the whole doc).
- Web-side integration behind a feature flag. `useSemanticDuplication` gets
  a v2 mode that uses atom-level matching + deterministic scoring.
- Tests against corpus known-duplicate pairs.

**Gate:** on corpus known duplicates, v2 scoring hits ≥ 85% precision at
recall 0.7. v1 baseline from Phase 0 is the reference. If v2 doesn't beat
v1 on at least one axis, thresholds need retuning.

**Effort:** ~1.5 days.

---

## Phase 5 — NLI contradiction detection

**Goal:** replace v1's LLM contradiction guess with a per-pair NLI check
restricted to same-section atom pairs.

**Deliverables**
- Reuse `nli.py` from Phase 2 with a contradiction-scoring head.
- `POST /v2/contradict` — endpoint. Input: pair of atoms + section label.
  Output: `(entailment, neutral, contradiction)` scores and a suggested
  verdict.
- Only run on atom pairs within the same canonical section (Kira's
  clause-type framing). Cross-section pairs skip.
- Web-side integration behind the same feature flag.
- Tests against corpus known-contradiction pairs.

**Gate:** on corpus contradictions, precision ≥ 80% at recall 0.6.
False-positive rate on the "related but not contradictory" pairs must be
below 15%. If NLI over-flags, add a gpt-4o-mini second-opinion step for
borderline cases (contradiction score in 0.4-0.7).

**Effort:** ~1 day.

---

## Phase 6 — Consolidate + feedback

**Goal:** the fixes and the flywheel.

**Deliverables**
- `services/testrunner/app/consolidate.py` — gpt-4o-mini call that takes a
  section's distinct atoms and rewrites them as a coherent block
  preserving every atom's semantics. Refusal path when the LLM judges the
  inputs to actually describe distinct entities (same guardrail as merge).
- `POST /v2/consolidate` — endpoint. Different prompt from `/merge-cluster`
  (preserve, don't drop).
- `POST /v2/feedback` — records `(chunk_hash, model_label, correct_label,
  timestamp, user_id?)`. Writes to a sqlite file inside the sidecar
  container. Simple `GET /v2/feedback/stats` to see how many rows have
  accumulated per label transition.
- Web-side integration: user corrections at layers 1-4 write to
  `/v2/feedback` in the background. No UI blocking.

**Gate:** consolidate refusal works (test with a two-agent-defs case and
confirm the LLM refuses). Feedback writes are persisted across container
restarts. No accuracy gate — this is plumbing for future fine-tuning.

**Effort:** ~1 day.

---

## Phase 7 — End-to-end eval

**Goal:** decide whether v2 is worth shipping.

**Deliverables**
- Full v2 pipeline runs on every corpus prompt.
- Report table: per-prompt v1 vs v2 precision, recall, F1 for
  duplicate detection, contradiction detection, section classification.
- Latency measurements per stage.
- Cost per audit (LLM calls only).
- "Where v2 is worse than v1" section, honest.

**Gate:** v2 beats v1 on precision by ≥ 10 percentage points on duplicate
detection AND doesn't lose more than 5 percentage points of recall.
Contradiction detection: v2 beats v1 on precision by ≥ 15 points, recall
within 10 points. If gates fail, retro on which stage's inaccuracy dominates
and iterate before proposing a migration.

**Effort:** ~0.5 day.

---

## Phase 8 — Integration decision & UI wiring (only if Phase 7 passes)

**Goal:** land v2 in the app behind a feature flag, one view at a time.

**Deliverables** (only planned after Phase 7 gate passes; concrete scope
depends on eval results)
- Feature flag in web app: `richprompt.pipeline.version` in localStorage,
  set via Settings.
- Migrate Structure view to `/v2/segment` + `/v2/classify`. Add section
  boundary drag adjustment.
- Migrate Duplication view to `/v2/atomize` + deterministic scoring.
  Add atom-level review UI.
- Migrate Contradictions view to `/v2/contradict`.
- Migrate Merge to `/v2/consolidate`.
- Corrections write to `/v2/feedback`.
- Cache invalidation: at cut-over, clear all `richprompt.semantic.cache`
  entries.

**Effort:** ~3-4 days.

---

## What NOT to build in the spike

- Fine-tuning any model. That's post-Phase 8 once feedback has accumulated.
- Cross-corpus (multi-prompt) search. Requires P7 workspace file loader.
- IndexedDB migration for atom storage. localStorage is fine for a spike.
- Any UI polish beyond what the phase requires. This is a proof of concept.

## Rough total effort

Phases 0-7 (spike + eval): ~8 days.
Phase 8 (integration, if gates pass): ~3-4 days.

Real number probably 12-15 days end to end with the usual friction. Each
phase gate is real — if Phase 3 (atomization) can't hit F1 0.75, we stop
and rethink instead of pouring days into Phase 4+.

## Success criteria — the "did this work?" summary

v2 is worth shipping if all four hold:

1. **Precision lift on duplicates ≥ 10 points** vs v1 baseline.
2. **False-positive rate on "related, not duplicate" ≤ 5%** on corpus
   (the specific failure mode that motivated this).
3. **Contradiction precision ≥ 80%** with recall ≥ 60%.
4. **Latency per audit ≤ 2× v1** (v2 does more work; some slowdown is OK,
   but not runaway).

If two or fewer of these hold, we go back to the drawing board.
