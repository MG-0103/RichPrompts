# Prompt/Tool/Skill Linter — Architecture

## Context

This continues a prior session. The goal: enforce better prompt writing across a multi-agent system by giving authors ESLint-style static feedback — deterministic, explainable, instant — rather than routing everything through an LLM for mushy advice. The same approach extends naturally to tool descriptions and skill files (SKILL.md), since both are just narrower, more mechanical variants of "text that steers a model." This doc lays out the architecture for building that as a website, building on the rule ideas already sketched (structural checks, anti-pattern detection, injection risk, multi-agent-specific checks, readability, tool/skill trigger-boundary checks, and cross-registry overlap detection).

## Guiding principle: three tiers, never blended

Everything in this system falls into one of three tiers, and the architecture keeps them structurally separate so the product never regresses into the "everything is an LLM suggestion" problem that motivated this whole effort.

Tier 1 is deterministic single-document rules — regex, AST structure, word lists, readability formulas. These run instantly, client-side, and are fully explainable: every diagnostic points at a rule ID and a specific span of text. Tier 2 is deterministic cross-document analysis — mainly embedding-similarity comparisons across the whole tool/skill registry to catch overlapping trigger conditions. It's still not asking a model to "judge quality," just computing distances, but it needs the full registry loaded and a bit more compute, so it runs as a background pass rather than on every keystroke. Tier 3 is optional LLM-based review for genuinely subjective judgment calls (is this a good few-shot example, is the tone right). It lives behind its own button/panel and its output is visually and structurally distinct from Tier 1/2 diagnostics — never merged into the same list.

## Pipeline

The core pipeline is the same shape as any linter, and it's the same pipeline for all three document types (prompts, tool descriptions, skills), parameterized by which rule pack and parser variant applies:

```
source text
  → Parser            (produce a ParsedDoc: sections/AST + offset index)
  → Rule Engine        (run the applicable rule pack against ParsedDoc)
  → Diagnostics         [{ruleId, severity, message, range, fixSuggestion?}]
  → Aggregator/Scorer   (per-doc score, trend across versions)
  → Presentation        (Monaco markers, Problems panel, score badge)
```

Because every stage shares this contract, adding a fourth document type later (say, an eval-rubric linter) means writing a new parser + rule pack, not new infrastructure.

### Parser

For prompts and skills, the parser splits the source into a lightweight tree by markdown headers, XML-style tags (`<role>`, `<task>`, `<constraints>`), and frontmatter blocks, preserving byte offsets at every node so diagnostics can be mapped back to exact editor ranges. It also extracts a flat list of `{{template_variables}}` referenced in the body. For tool descriptions, which are structured JSON (name, description, parameters), the "parser" is really a schema walker that produces the same `ParsedDoc` shape (sections become: name, description, each parameter) so downstream rules don't need to know the difference. Output shape:

```
ParsedDoc {
  docType: "prompt" | "tool" | "skill",
  sections: Section[],          // {kind, text, startOffset, endOffset}
  variables: string[],          // template vars found
  raw: string,
  offsetIndex: OffsetIndex      // maps offsets <-> {line, col} for the editor
}
```

### Rule interface

Every rule is a pure function, matching the ESLint model, which is what makes rules independently testable and lets teams enable/disable/re-tier them per workspace via config rather than code changes:

```
Rule {
  id: string,                     // e.g. "prompt/no-vague-qualifiers"
  pack: "prompt" | "tool" | "skill" | "registry",
  defaultSeverity: "error" | "warn" | "info",
  appliesTo: DocType[],
  check(doc: ParsedDoc, ctx: RuleContext): Diagnostic[],
  fix?(doc: ParsedDoc, diagnostic: Diagnostic): Edit[]   // optional autofix
}
```

`RuleContext` carries anything a rule needs beyond the single document — for Tier 2 registry rules, that's a handle to the full set of sibling tools/skills and their precomputed embeddings.

### Diagnostics and the editor

The diagnostic shape is deliberately chosen to map 1:1 onto Monaco's `editor.setModelMarkers` format, so the adapter between "rule engine output" and "squiggly underline in the editor" is a thin, mechanical translation rather than a redesign:

```
Diagnostic {
  ruleId: string,
  severity: "error" | "warn" | "info",
  message: string,
  range: { startOffset, endOffset },   // or {startLine, startCol, endLine, endCol}
  relatedInfo?: { docId, range, message }[],   // e.g. "overlaps with tool X"
  fixSuggestion?: Edit[]
}
```

Quick fixes plug into Monaco's `registerCodeActionProvider`; hovering a squiggle uses a custom hover provider that links out to a rule-docs page explaining why the rule exists (mirrors VS Code's "Quick Fix" and rule-info-on-hover UX).

## Rule packs

Four packs share the pipeline above but carry different pattern libraries:

- `prompt-rules` — structural completeness (missing role/task/output-format/constraints sections), missing delimiters between instructions and data, undefined template variables, vague qualifiers and hedge words (word-list/regex), contradictory imperatives, injection-risk concatenation points, readability metrics (Flesch-Kincaid, passive-voice ratio, sentence-length outliers via a small library like `retext`/`write-good`), and missing stop/success conditions.
- `tool-rules` — ambiguous trigger boundary (no "don't use for X" clause when sibling tools share verbs/nouns), vague parameter docs (too short, missing type/format/units), missing return-shape description, weak verbs ("process," "handle," "manage"), name/description mismatch, missing example invocation.
- `skill-rules` — trigger-description breadth (needs both positive triggers and explicit exclusions), missing routing examples, structural completeness of the body (reuses most of `prompt-rules`), and stale references (a cited tool name or file path that no longer exists in the registry — a plain existence check, not a judgment call).
- `registry-rules` (Tier 2, cross-document) — embedding-similarity clustering across all tool and skill descriptions in the registry, flagging pairs above a similarity threshold for human disambiguation, plus a registry-wide name/description consistency scan.

Rules are registered as data (id, pack, severity, applicable doc types), so a new rule is a new module drop-in, not a UI change, and a team's `.lintrc`-equivalent config can toggle or re-tier any rule without touching code.

## Scoring and trends

Each document gets a score derived from weighted diagnostic counts (e.g., errors −10, warnings −3, info −1, floored at 0), and every lint run is snapshotted keyed by document hash/version. That snapshot history is what turns this from "a linter" into "a CI-style gate": a prompt/tool/skill change in a PR can be diffed against the previous snapshot's score, and a workspace-level dashboard can chart score trends across the whole agent system over time.

## Product architecture

The frontend is Monaco Editor (the real VS Code editor component) inside a React app, giving markers, a Problems panel, hover-to-explain, and code-action quick fixes essentially for free instead of having to build that UX from scratch. Tier 1 rule execution runs in a web worker on the client so linting never blocks the editor thread and stays instant on keystroke. Tier 2 (embeddings) and Tier 3 (optional LLM review) require the full registry and a model call, so they run through a backend API and populate a separate panel rather than inline markers, keeping the tiers visually distinct as described above.

Data model, roughly: `Document {id, type, ownerAgentId, content, versionHistory}` for individual prompts/tools/skills, and `Registry {tools[], skills[], agents[]}` as the thing Tier 2 rules query against. Rule config is per-workspace JSON, editable in a settings panel, following the same shape as an `.eslintrc`.

For teams that want this outside the editor, the same rule-engine core (parser + Tier 1 rules, framework-agnostic TypeScript with no DOM dependency) ships as a standalone package usable from a CLI or pre-commit hook, so "lint this prompt" can fail a PR the same way `eslint --max-warnings 0` does today — this is what makes the earlier "CI gate for prompt PRs" idea real rather than aspirational.

## Suggested build order

1. Parser + 6-8 structural `prompt-rules`, no editor yet — validate the rule engine and diagnostic contract with unit tests against known-bad prompts.
2. Monaco integration: markers, Problems panel, quick fixes for the 2-3 easiest autofixable rules (e.g., inserting missing delimiters, flagging undefined variables).
3. Extend to `tool-rules` and `skill-rules`, reusing the parser/diagnostic infra — this is where the "narrower, more mechanical" advantage pays off, since these packs are smaller and more pattern-based than open-ended prompts.
4. Tier 2: registry-wide embedding-similarity pass as a background job with its own panel and `relatedInfo` cross-references.
5. Tier 3 (optional LLM review button), workspace rule config UI, score/trend dashboard, and extraction of the CLI package for CI.

## Open questions worth deciding before M1

What embedding source Tier 2 uses (a local small model vs. a hosted embeddings API) is a cost/latency/deployment tradeoff worth pinning down early since `registry-rules` depends on it. Similarly worth deciding early: whether rule config lives per-workspace or per-agent (a customer-support agent's prompt rules might reasonably differ from an internal-tools agent's), and what the minimum viable "registry" data source looks like — i.e., does this read tools/skills from files in a repo, from a database, or via an API into whatever system currently defines these agents.