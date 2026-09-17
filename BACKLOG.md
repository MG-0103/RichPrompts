# Backlog

Deferred ideas, revisit before shipping.

---

## Active queue (2026-09-17)

Decided during the "current implementation refinement" discussion.

1. **1.1 Extraction: soft-kill (SHIPPED THIS COMMIT).** Removed from
   `analyzeStructure()` report + `StructurePanel` UI + CSS. Regex
   detectors (`detectExtractionCandidates`, `ExtractionCandidate`,
   `ExtractionTarget`) still exported from `@richprompt/core` so
   R1ζ can wire them back in behind the LLM verifier. Extraction
   tests still pass. False-positive rate on real prompts made the
   feature net-negative — regex can't tell "propose to extract"
   from "describe existing behavior."
2. **1.2 Duplication: show WHAT is shared.** LCS + shared n-grams on
   each cluster row so users don't have to eyeball diffs to see the
   overlap.
3. **R1ζ (Bucket 2 full):** OpenAI embeddings via sidecar `/embed`
   endpoint + web "Deep analyze" + LLM verifier pass that
   classifies pairs as duplicate / contradictory / related-but-
   distinct / unrelated. Contradictions become their own finding.
   Extraction resurrected using the verifier (procedure-to-extract
   vs. behavior-description).

### Deferred (from the consolidated plan)

- **1.3 Rules-too-lenient tune-up** — severity bumps + 2 threshold
  tightenings + missing rules (contradictions/success-conditions/
  examples). ~1 hr. Ships when we return to it.
- **Bucket 3 (P7) — Workspace file loader.** Approach B locked;
  ~3½ days. Highest-value real-use enabler once R1ζ is in.
- **Bucket 4 — Test-runner audit follow-ups:** `.promptfoo.yaml`
  ingest (4.1), P16 reliability (SSE progress, model UI, cost
  preview, retries, Docker), P17 distractor injection, P18 CI
  export as a Promptfoo-compatible CLI.
- **Bucket 5 — Tests-tab node-graph playback view.** Prerequisite:
  review `MG-0103/Agent_Builder` client folder for reusable node/
  edge UI.
- **Bucket 6 — Editor UX polish:** diagnostic-span highlighting in
  preview, IndexedDB storage migration when usage crosses 2 MB.
- **Bucket 7 — Positioning decisions:** phase-by-phase KEEP/CUT/
  REWORK audit; Phase 9 versioning fate; Phase 6 LLM Review fate.
- **Bucket 8 — Deep deferred:** prompt↔prompt duplication (needs
  P7), tool↔skill cross-check, orphan-tool cross-ref, trigram →
  MiniLM upgrade for Tier-2 (folds into R1ζ), ADK LlmAgent lift.

Full sizing + dependencies were captured in the discussion; not
re-inlining here to keep this readable. When we return to any
bucket, refer to the consolidated plan for size estimates.

---


## Strategic audit — reinvention risk & positioning

Reflection during discussion: prior-art overlap wasn't researched before
building, and several shipped features duplicate what mature products
already do. Recording the audit here so it stays in view as we decide
what to keep, cut, and double-down on.

### Prior-art overlap (features that exist elsewhere)

- **PromptLayer, Pezzo, Humanloop, PromptHub** — prompt versioning +
  registry. Our Phase 9 (auto/commit history) is a smaller, worse
  version.
- **Braintrust, Promptfoo, LangSmith** — prompt/routing evals with
  test suites. Our P10-P15 test runner is a reinvented subset.
  Braintrust and Promptfoo are more mature; Promptfoo's YAML format
  is an open de-facto standard.
- **Langfuse, Helicone** — LLM observability + prompt management with
  logging. We don't overlap here (no logging today) but adjacent.

### What is genuinely differentiated (double-down)

- **In-editor deterministic linter** (Monaco squiggles, hovers, rule
  packs). None of the above lint prompt files this way. Core value.
- **Tier-2 registry-wide overlap detection** (tool/skill trigger
  collisions). Not a standard feature elsewhere.
- **R1 Structure analysis** for large prompts (section map, duplication
  clusters, extraction candidates, model-aware budget). Not standard.

### What to reconsider

- **Test runner (P10-P15).** Keep the local Python sidecar for
  in-editor feedback. But add ingest for **Promptfoo's YAML format**
  so users with existing Promptfoo test suites don't have to
  re-author. Compete on "linter + routing signal", not on "eval
  infrastructure."
- **Versioning (P9).** localStorage version history is worse than
  git. Consider: (a) keeping as a low-effort safety net, (b) advising
  "use git" and killing it, or (c) shipping it as an *export* format
  ("save this commit as a `.md` at path X") rather than a private store.
- **LLM Review (P6).** Keep small or delete if unused. Overlaps
  weakly with LLM-as-judge features in every eval tool.
- **CI export (P18, unshipped).** Should ship as compatibility with
  Promptfoo's CI pattern rather than a new one. Users who already run
  Promptfoo in CI plug ours in via config, not via a second workflow.

### Positioning principle: format-not-platform

The trap: "integrate with X's SaaS." That creates subscription
dependency, account requirements, and vendor lock — the exact opposite
of what a local-first developer tool should do.

The fix: **integrate with open file formats and protocols, not with
platforms.** ESLint reads `.eslintrc`. TypeScript reads `tsconfig.json`.
Prettier reads `.prettierrc`. Nobody signs up for anything.

- Adopt: Promptfoo YAML, OpenAI function-calling schema (already do),
  SKILL.md frontmatter (already do), OTEL spans for optional trace
  export.
- Do not require: accounts, remote APIs (beyond the user's own model
  provider keys), hosted dashboards.

### Concrete follow-up tasks

- [ ] Audit each shipped phase against the differentiation check
      above; mark KEEP / CUT / REWORK.
- [ ] Add `.promptfoo.yaml` ingest to the test runner (Phase 16.x?).
      Parse, run through the same sidecar path, surface the same
      per-test metrics.
- [ ] Decide fate of Phase 9 versioning: keep-as-is, kill, or export.
- [ ] Re-scope Phase 18 CI export as a Promptfoo-compatible CLI
      instead of a new format.

### Lesson recorded

For future features: **spend 30 minutes surveying prior art before
building.** Naming existing tools and the specific gap our approach
fills is cheap. Re-implementing eval infrastructure from scratch
because we didn't check is not.

---


## Phase 10 → 18 — Stub agent testing (routing-quality gate)

**Goal:** for each edit to a prompt/tool/skill, verify the router still
picks the intended target on a set of predefined queries, and quantify
how confidently.

**Composite metric decided.** `RoutingScore = 0.7 * passRate + 0.3 *
norm(meanLogprob)`. Secondary: mean trajectory steps, `descriptionDelta`
from names-only ablation. Reasoning tokens rejected as too noisy on
their own.

**Framework:** Google ADK (Python sidecar). Web app is TS/React;
sidecar owns anything model-touching. Contract in
`packages/core/src/testing.ts`, mirrored in
`services/testrunner/app/schemas.py`.

**Storage:** per-workspace test cases in localStorage
(`richprompt.tests.v1`).

### Phase status

- **10 — Foundations (mock runner + contract):** SHIPPED.
- **11 — Real routing decision (single rollout):** SHIPPED.
  Implemented with `google-genai` directly rather than `google.adk`
  because ADK's decorator-based tool registration fights our
  "tools defined by external JSON" model. Same underlying model
  (Gemini) and same tool-call semantics; `LlmAgent` swap-in is a
  single-file change in phase 12.x when trajectory events pay off.
  `temperature=0`. Logprobs not surfaced by Gemini for function
  calls yet — deferred to phase 12.
- **12 — N-rollout pass rate + concentration:** SHIPPED.
  N=5 parallel rollouts at temp=0.7 via ThreadPoolExecutor. Gemini
  doesn't yield logprobs on function calls, so confidence comes
  from **concentration** = fraction of rollouts on the modal choice
  (with a mild tie penalty). Cache keyed by sha256 over
  {prompt, sorted tools, sorted skills, test, config}; per-test
  hit/miss so partial re-runs are free. Backlog: reranking-probe
  confidence signal is still open (phase 12.x), as is a real ADK
  `LlmAgent` lift for trajectory events (phase 12.y).
- **13 — Tests tab authoring/results UX:** SHIPPED.
  Test editor now offers a registry-derived datalist for
  `expect.name` (skill names sanitized the same way the sidecar
  does, so the UI-visible name matches the routed name). A warn
  hint appears when the entered name isn't in the current
  registry. Rows expand to reveal per-rollout details (called
  target, latency, error). Config strip (rollouts, temperature,
  model) with per-workspace persistence; the current settings
  live in a chip in the header for at-a-glance status.
  Latency-p50 column added. "Clear cache" button in the header.
  A running banner with elapsed time replaces the silent
  loading state.

  Deferred to phase 16: real SSE progress (per-test streaming
  updates instead of the current single-shot POST) — the running
  banner is honest that we don't know per-test progress today.
- **14 — Names-only ablation:** SHIPPED.
  `config.ablation: true` runs each test twice: once with real
  descriptions, once with tool and skill frontmatter descriptions
  stripped. Cache uses a `stripped` axis (not the `ablation` flag),
  so full and stripped passes cache independently and each is
  reusable across ablation-on and ablation-off runs. UI shows
  `desc-Δ` per test (green when high, red when negative — negative
  means the description misled the model) plus a footer summary
  ("descriptions doing work: mean Δ, count above 20pp, count where
  stripped won"). Rollout drill-down shows both passes stacked.
- **15 — Snapshot-diff runs:** SHIPPED (routing-quality diff only;
  per-doc history/restore still open in Phase 9 proper).
  Rather than wait on Phase 9's full jsdiff/restore/History-tab
  scope, this shipped the minimum needed for the routing-quality
  diff: full-registry pins ({prompt, tools, skills} at one moment)
  stored under `richprompt.registry.pins.v1`. Selecting a pin fires
  a second /run in parallel against the pin sources; each pass is
  cached separately (same content-hash key), so a re-run of the
  same current-vs-baseline suite is essentially free.
  UI shows the current metrics with inline Δ chips (pass, conc,
  score) against the baseline. Δ chips are green when current
  beats baseline, red when it regressed — the "did this edit help
  routing?" question in one glance.
- **16 — Reliability + config:** model selection, cost preview,
  retries, streaming results, sidecar Dockerfile.
- **17 — Distractor injection:** paraphrased sibling tools;
  cross-link to Tier-2 overlap detector for behavioral verification.
- **18 — CI export:** `@richprompt/testrunner-cli`; fail a PR on
  passRate regression. Companion GitHub Action.


## Tests tab — node-graph playback view (NOT SHIPPED — design discussion)

Idea (from discussion): add a graph-based playback view to the Tests
tab alongside the existing table. One test at a time, agent as a
center node, tools/skills as spokes, rollouts animated as "control
tokens" flowing along the chosen edge. Debugging aid, not a scanner
replacement.

Source: React Flow (`@xyflow/react`, ~150 KB gzipped). We might reuse
UI components from the `MG-0103/Agent_Builder` repo (client folder)
rather than build the node/edge visuals from scratch — pending a
look at that code.

**Framing (locked): two views in the Tests tab, toggleable.**
- Table view (default) — 30 tests, all metrics visible, fast
  scanning. What we have.
- Playback view (new) — pick one test → animated graph → play
  through N rollouts. For debugging a specific failure.

**Visual specifics under consideration:**
- Nodes: agent (center), each tool/skill in the current registry
  (spokes). Node color by kind (tool/skill/none).
- Edges: light grey static baseline. Rollout picks the edge → it
  animates + thickens + colors while the "control token" flows to
  the target node.
- Edge thickness after all rollouts complete = rollout count on
  that path — visual analogue of the concentration metric.
- Expected target node gets a subtle outline so misses are
  visually obvious.
- Optional: side-by-side full-descriptions vs. stripped-descriptions
  playback when ablation is on. See where rollouts drift.

**Uses data we already produce.** `TestResult.rollouts[].called`
carries everything the graph needs. No sidecar changes required.

**Where it helps:**
- Debugging one failing test — visual is more intuitive than a
  rollout table.
- Concentration made visible (thick vs. scattered edges).
- Cross-check to the ablation delta at a glance.

**Where it doesn't help (why we keep the table):**
- Suite-wide scanning — a 30-test graph is a mess.
- Information density — a pretty edge loses the rollout error
  string, latency-per-rollout, arg values. Keep the drill-down
  table for facts.
- "None" tests (expected: no call) have nothing to animate.

**Est effort:** ~1–1.5 days once we have Agent_Builder's node UI
as a starting point, or ~2 days from scratch.

**Prerequisite:** review the Agent_Builder `client/` folder — adapt
node/edge components, don't blind-copy.

---

## Phase R1 — Structure panel for large prompts (NOT SHIPPED — design locked)

**The problem it addresses.** Static rules are the wrong tool at scale.
For a prompt > 15k chars, listing 300 diagnostics is worse than useless
— authors need a strategic view: "what shape is my prompt in, what
duplicates what, what can I extract, what's dead weight." R1 answers
that with deterministic analysis + graph-driven duplication view.

### Design locked

**UI shape**
- New "Structure" bottom tab. Red dot when current prompt > 5k (no
  hijack — auto-focus off).
- Sections stacked bar (char + token proportions) colored by
  canonical role.
- Model-budget bar: driven by whatever model is set in Tests config.
  `chars / 4` token estimate with "approx" caveat in tooltip.
- Three grouped finding sections: **Duplication**, **Noise**,
  **Extraction candidates**.

**Paragraph unit**
- Blank-line-delimited block, respecting heading and XML boundaries.
- Fenced code blocks stay whole. Numbered lists stay whole.
- Typical: 200–2000 chars per block, ~50–200 per 85k prompt.

**Duplication — two-tier**
- Default: trigram Jaccard (existing similarity infra).
  Threshold 0.5 (Recommended default; configurable).
- "Deep analyze" button: OpenAI `text-embedding-3-small` embeddings
  via a new sidecar `/embed` endpoint. Cosine matrix, threshold ~0.7.
  Per-paragraph cache keyed by content hash — edits only re-embed
  changed paragraphs.
- Cost math: 85k prompt ≈ 21k tokens → $0.0004 per full deep pass.
  Negligible.

**Graph visualization (d3-force)**
- Nodes = paragraphs. Size = char count. Color = canonical section.
- Edges above similarity threshold. Thickness = strength.
- Isolated nodes (no edges) shown greyed out — represent unique
  work; safe-to-keep list.
- Interactions: hover → tooltip + cluster highlight; click → jump
  to editor; drag → repel; min-similarity slider.
- ~30 KB gzipped, dynamic-imported when Structure tab first opens.

**Cluster advice — templated**
- "N paragraphs in {section} share X% similarity. Common theme: {…}.
  Merge saves ~Y chars."
- "Paragraph in {sectionA} is X% similar to one in {sectionB} —
  instruction leaked across sections."
- "Cluster of N paragraphs spans {sections} — suggests a dedicated
  {theme} section would consolidate."

**Noise flags (deterministic)**
- HTML comments (`<!-- -->`)
- Author markers (TODO / FIXME / XXX / HACK)
- Placeholder tokens (`[REDACTED]`, `[PLACEHOLDER]`, `[TBD]`)
- Empty XML tags
- Excessive blank runs
- Boilerplate tails: last 800 chars matched against a short phrase
  list ("you are a helpful assistant", "be polite", "do not lie").
  Only fired when in trailing region OR duplicative with an
  earlier canonical Role section — cuts false positives.

**Extraction candidates — balanced mode**
- Schema: heading matches `response|output|json|format` + JSON-shaped
  body. ~90% precision.
- Tool: paragraph contains 3+ numbered procedure lines (imperative
  verbs, deterministic operations). ~70% precision.
- Skill: paragraph starts with `IF|WHEN|WHENEVER` + 2+ imperative
  follow-up lines. ~60% precision. Explicitly labeled "candidates".
- RAG-candidate and delete-candidate deferred to R2 (ablation)
  and R3 (LLM-assisted classifier).
- Copy-to-clipboard action for extracted target. File creation on
  disk is P7 territory.

**Runtime**
- Web Worker off-thread. Debounced 3s idle up to 30k chars;
  manual "Re-analyze" button beyond, with stale indicator.
- O(n²) pairwise similarity on paragraphs: safe up to ~200
  paragraphs; skip clusters if over.
- Dismissed findings persisted per `(docHash, findingSignature)`
  in localStorage so users don't re-see judged clusters.

### Sidecar changes for OpenAI embeddings

- New optional dep. Prefer `httpx` + direct REST over `openai` SDK
  to keep deps minimal.
- New endpoint `POST /embed`:
  ```
  request:  { texts: string[], model?: string }
  response: { vectors: number[][], cached_count: int }
  ```
  Sanity-cap texts array length and per-text length.
- Reads `OPENAI_API_KEY` from env. `/health` reports
  `openai: { available, reason }` mirroring the `real` field.
- Sidecar-side cache keyed by sha256(text + model), reusable
  across paragraphs identical across docs.

### File layout to build

```
packages/core/src/structure/
  index.ts          analyzeStructure() entry
  paragraph.ts      splitter
  duplication.ts    trigram + cosine variants
  noise.ts          deterministic detectors
  extract.ts        candidate heuristics
  budget.ts         model → practical token budget map
  types.ts          Paragraph, DuplicationCluster, NoiseFlag,
                    ExtractionCandidate, StructureReport

apps/web/src/worker/
  structure.worker.ts   receives raw + config, returns report

apps/web/src/components/
  StructurePanel.tsx    tab body
  DuplicationGraph.tsx  d3-force visualization
  SectionMap.tsx        stacked bar
  ClusterList.tsx       fallback list view

services/testrunner/app/
  embed.py              OpenAI embeddings via httpx
  main.py               /embed endpoint
```

### Estimated cost
- `packages/core/src/structure/`: ~400 lines
- Sidecar `/embed`: ~80 lines
- Worker: ~50 lines
- StructurePanel + graph + list: ~350 lines
- Total: **~900 lines** + 1 browser dep (d3-force) + optional
  httpx in sidecar.

### Explicit skips
- No paragraph-level ablation here — that's R2, needs test suite
  to be meaningful.
- No LLM-assisted paragraph classification — that's R3, adds cost.
- No file-creation on extract — that needs P7.
- No delta-compression on embedding cache — content-hash keys are
  sufficient at our sizes.

### Rules-too-lenient reframe
Kept in the backlog as a small follow-up: bump missing-sections
warn → error, missing-delimiter info → warn, and 2–3 other
severities that under-count real issues. ~15 lines of default
config change. Ships as a separate PR, not blocking R1.

## Phase 7 — Workspace file loader (NOT SHIPPED — needs deliberation)

**The gap this closes.** Everything today reads from
`packages/core/src/fixtures/sampleRegistry.ts` — three hardcoded tools
and two hardcoded skills. A real user has their tools/skills in files
on disk and has no way to point the linter at them. Every downstream
phase (P16 polish, P17 distractor, P18 CI gate) is only meaningful
once P7 lands. Without it the product is a demo of an idea.

### Three deployment shapes considered

| # | Files reach the app via | Runs where | Trade-off |
|---|---|---|---|
| A | Browser FS Access API (`showDirectoryPicker`) | Pure client | Chromium-only. Safari + Firefox don't support it. |
| B | Local HTTP bridge process | Client + a `richprompt serve ./workspace` CLI | Cross-browser. One more process. **Shares code with P18 CI export.** |
| C | Cloud / VCS backend | Server-side | Overkill for a per-developer tool. Real product path. |

### Recommendation: approach B

Deferring for user confirmation, but the reasoning:

1. **Cross-browser.** A is Chromium-only. B works everywhere.
2. **Code reuse with P18.** The Node process that serves files in dev
   is the same code path the CI CLI (P18) needs — walk the workspace,
   parse each doc, hand it to the sidecar. Splitting the walker into
   `packages/workspace/` lets P7 and P18 share one implementation
   instead of writing that logic twice.
3. **Watchable.** chokidar catches edits from other tools (VS Code,
   your editor of choice) and streams them into the linter via SSE.

### Approach B — concrete shape

Three-process dev now: vite (5173) + testrunner sidecar (8787) + new
file bridge (8788). All on 127.0.0.1, no auth.

```
packages/workspace/         ← shared library (P7 + P18)
  index.ts   walkWorkspace, parseDoc, writeDoc
  glob.ts    *.tool.json / SKILL.md discovery
  types.ts   DocEntry, Workspace shape

services/filebridge/        ← thin HTTP wrapper (P7 only)
  main.ts    imports packages/workspace, adds HTTP+SSE

packages/testrunner-cli/    ← P18 later
  main.ts    imports packages/workspace, calls sidecar directly
```

**Bridge endpoints (small, boring):**
- `GET /health` → `{ ok, workspace, version }`
- `GET /workspace` → `{ path, docs: [{ id, kind, relPath, mtime }] }`
- `GET /doc?path=…` → `{ path, content, mtime }`
- `PUT /doc` body `{ path, content, ifMatchMtime? }` — writes back;
  return 409 on mtime mismatch (optimistic concurrency).
- `GET /events` (SSE) → `{ kind: 'changed'|'added'|'removed', path, mtime }`

**Web-side changes (~150 lines):**
- `useRegistry`: on mount, GET /health; if 200 → workspace mode, else
  fall back to sample fixture. Enumerate via /workspace, hydrate via
  /doc.
- Subscribe to `/events` SSE. On 'changed', refetch that doc unless
  a PUT for that path is in-flight.
- On Cmd+S / commit, PUT /doc with the mtime we started editing from.
  On 409, prompt "file changed on disk — reload or overwrite?".
- Workspace selector (path input) in a new corner of the header or
  Settings tab.

**Convention over config, initially:**
- `**/*.tool.json` — each file is one tool doc.
- `**/SKILL.md` or `**/*.skill.md` — each file is one skill doc.
- `**/prompts/**/*.md` — optional prompt collection.
- Add `richprompt.config.json` at the workspace root when someone
  asks for custom layout (adds ~30 lines of glob resolver).

**Concurrency model:** mtime-guard on PUT (same pattern as git).
Never last-write-wins, never merge — those are wrong or too complex
for a per-workspace tool.

**Deps and cost:**
- New: chokidar in the bridge (~200 kb node_modules, zero browser cost).
- New dev command: `npm run dev:filebridge` alongside `dev` and
  `dev:testrunner`. Same pattern as today.
- Sidecar unchanged. Lint engine unchanged. Test runner unchanged.

### Explicit skips
- No Electron / native shell.
- No live-sync-every-keystroke to disk (phase 9 versioning already
  gives the "safety net" feel; disk writes go through Cmd+S).
- No merge-on-conflict — 409 with a reload prompt is enough.
- No auth on the bridge — it binds 127.0.0.1 only.

### Est
- `packages/workspace/`: ~250 lines.
- `services/filebridge/`: ~200 lines.
- Web wiring: ~150 lines.
- Total: ~600 lines + 1 dep.

### Decision still needed
- Approach A (FS Access) vs. approach B (bridge). Recommendation is B
  because it's cross-browser AND shares code with P18. Approach A is
  cheaper (~300 lines, no new process) but Chromium-only and duplicates
  logic P18 will need anyway.

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

## Phase 9 — Versioning + diff + restore (SHIPPED — see below)

Linear history per doc with the ability to restore any prior iteration
and diff against it.

**Shipped shape (revised from original design):** two-tier — auto-saves
(2s idle debounce, hash-dedup, cap 20/doc, LRU-evicted) plus explicit
commits (Cmd+S / "+ Commit version" with a label, kept forever until
user deletes). jsdiff dynamic-imported so the ~4.5 kB gzipped chunk
never hits the main bundle — only fetched on first diff render.

**Original locked design below — retained for context / rationale.**

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
