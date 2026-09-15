# Backlog

Deferred ideas, revisit before shipping.

## Phase 4 — Registry checks (extensions)

Current impl checks within-kind description overlap (tool↔tool, skill↔skill).
Under deliberation:

- **tool ↔ skill cross-check** — some agents use tools and skills
  interchangeably; router can still confuse them. Cost: near-zero,
  same similarity engine. Risk: noise for agents that intentionally
  keep parallel tool + skill for the same intent.

- **prompt ↔ prompt duplication** — only meaningful with a shared
  prompt library. Not useful for single-editor sessions. Needs a
  registry-of-prompts concept + workspace file loader (Phase 7).

- **orphan-tool cross-ref** — prompt mentions `search(...)` but no
  matching tool in the registry. Ported from the branch's
  `check_undefined_tool_references`. Needs "current prompt" fed into
  registry rules. Cheap once wiring exists.

- **embeddings upgrade** — replace trigram Jaccard with sentence-level
  embeddings (local `Xenova/all-MiniLM-L6-v2` via transformers.js, or
  hosted API). Trigger only if trigram misses semantic paraphrases
  users care about (evaluate on real registry data first).

## Phase 9 — Versioning + diff + restore

Linear history per doc with the ability to restore any prior iteration
and diff against it.

**Design (locked):**
- Extend `Snapshot` with optional `content: string` and optional
  `label: string`. Old (metadata-only) snapshots kept read-only and
  rotate out naturally.
- Storage: same `localStorage` key `richprompt.snapshots.v1`. Cap 50
  unnamed per doc, named unlimited (~1.5MB budget vs ~5MB cap).
- Cadence unchanged: 1.5s auto + hash-dedupe.
- Restore = clone-forward (creates a new snapshot with old content,
  labeled `restored from vN`). Nothing is ever lost. Confirm dialog
  only when current content is not in any existing snapshot.
- Dep: `diff` (kpdecker/jsdiff, ~30kb). Skip `isomorphic-git` (800kb,
  wrong shape for single-file editor).
- UI: new "History" bottom tab. Version list (timestamp / score /
  delta / label / restore / delete). Click one → inline unified diff
  vs current. Select two → diff between them.

**Explicit skips:** branching, merge, remote sync, side-by-side diff
view, cross-doc diff.

**Est:** ~250 lines + 1 dep.

## Preview pane — diagnostic-span highlighting

The MD/tool preview shows what the model sees, but hovering a
Problems row doesn't highlight the corresponding span in the
preview yet. Doable but non-trivial:

- Configure the markdown pipeline to preserve source positions
  (remark already carries `position.start.offset` /
  `position.end.offset` on AST nodes — free).
- Write a rehype plugin that stamps every rendered element with
  `data-src-start` / `data-src-end`.
- On hover/click of a Problems row, walk the preview DOM, find
  nodes whose range overlaps the diagnostic, add a highlight class.
- Partial-node highlighting (a diagnostic mid-paragraph) requires
  splitting text nodes via the Range API, re-applied on each
  render — fiddly.

**Skip until:** users report actually wanting it. The Problems
panel already jumps the editor to the span, which handles the
"where is this" question in the more useful direction. Sync
scroll (shipped) makes finding it in the preview a scroll away.

**Est:** 1–2 days.

## Storage migration — localStorage → IndexedDB

Snapshots (phase 5, and phase 9 once built) live in `localStorage`
under one key. Fine for now (~1.5MB budget vs ~5MB cap), synchronous
access is imperceptible at our sizes.

**Migrate when either triggers:**
- Observed usage > 2MB (approaching quota; a doc with 50 pinned versions
  at 30KB each already crosses it)
- Users want cross-tab live sync (localStorage is per-tab; IndexedDB has
  a broadcast channel)

**How:** ~100 lines of adapter with the same shape as
`apps/web/src/persistence/snapshots.ts` — async fns behind the same
call sites. `idb-keyval` (~1kb) covers 90% of the need.

Cross-device / team sharing = backend, separate concern.
