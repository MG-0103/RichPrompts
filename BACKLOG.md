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
