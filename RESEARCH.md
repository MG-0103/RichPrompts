# RichPrompts — Technique Audit & Research (2026-09-21)

Purpose: for each analysis technique currently shipped in `packages/core`, check
what the literature and production tooling actually recommend, verdict our
choice, and note the upgrade path when one is worth it. Sources link out at the
bottom of each section.

The short version, up front:

| Technique | What we do | Verdict | Highest-leverage upgrade |
|---|---|---|---|
| Near-dup (fast pass) | Trigram Jaccard, pairwise, threshold 0.5 | Correct for small N, wrong at scale | Keep for ≤ 250 paragraphs, layer MinHash-LSH beyond |
| Near-dup (semantic pass) | Off-line embeddings + cosine | Correct choice; MiniLM is the right default | Add a cross-encoder reranker on top-K only |
| Clustering | Union-find over pairs above threshold | Fine for the size we run at | HDBSCAN only becomes worthwhile with embeddings + N > ~1k |
| Shared-span extraction | Longest common substring (DP) + 3-5-word n-grams | Correct given cluster sizes | Suffix-array only matters past ~10 members |
| Section classification | Regex over headings + strong-opening body patterns | Correct as a first pass; expected to miss paraphrases | Optional zero-shot LLM fallback for unheaded prose |
| Prompt anti-patterns | Regex rules for stacking / emphasis inflation / negatives / vague triggers | Aligned with published Anthropic + prompt-lint tool guidance | Broaden ruleset; keep zero-model latency |
| Missing-sections | Canonical classifier + body inference | Now correct after the recent fix | Ship a small labeled fixture set to lock behavior |

---

## 1. Duplication — the fast pass (trigram Jaccard)

**What we do.** `similarity.ts` builds character 3-grams per paragraph, then
`analyzeDuplication` does an O(n²) all-pairs Jaccard, thresholds at 0.5, and
unions the pairs into clusters. Guardrails: `minChars: 60`, `maxParagraphs: 250`.

**Is it right?**
- Character trigrams + Jaccard is textbook near-duplicate detection. It's fast,
  interpretable, and catches copy-paste + minor edits well. It **does not**
  catch paraphrases with different wording — this is the well-known
  limitation of any n-gram / lexical method, and the semantic pass is what
  covers it.
- The threshold 0.5 matches what the literature calls "clearly near-duplicate"
  for character-3-gram Jaccard. Lower (0.3) starts folding unrelated but
  same-domain paragraphs together.
- O(n²) is the right shape at our scale. MinHash-LSH becomes worthwhile only
  once N crosses a few thousand items; at 250 items, 30 k comparisons costs
  ~ms, so LSH's constant factors are actually a loss.

**Where it will bite us.**
- The 250-paragraph cap is a hard cliff — a 100 KB prompt with lots of small
  paragraphs will silently skip duplication. Better to switch algorithms above
  that threshold than to disable.
- Character trigrams over-count whitespace and stopword bigrams. Word-level
  shingles (which is what MinHash traditionally uses) usually generalize
  better once paragraphs are long.

**Upgrade path (only if we hit the cap).**
1. Word-shingle MinHash + LSH bands (`b=20, r=5`, 100-hash signatures) as a
   candidate filter above N = 250.
2. Keep our current Jaccard as the exact score on candidate pairs only.
3. This is what open-source pipelines (`text-dedup`, Milvus native MinHash-LSH,
   Zilliz's trillion-scale dedup) do. Not urgent.

Sources:
[RETSim: Resilient and Efficient Text Similarity](https://arxiv.org/pdf/2311.17264) ·
[In Defense of MinHash Over SimHash](https://arxiv.org/pdf/1407.4416) ·
[apxml: Near-Duplicate and Exact Duplicate Detection](https://apxml.com/courses/how-to-build-a-large-language-model/chapter-7-data-cleaning-preprocessing-pipelines/near-duplicate-exact-duplicate-detection) ·
[text-dedup on PyPI](https://pypi.org/project/text-dedup/) ·
[Zilliz — Data Deduplication at Trillion Scale](https://zilliz.com/blog/data-deduplication-at-trillion-scale-solve-the-biggest-bottleneck-of-llm-training)

---

## 2. Duplication — the semantic pass (MiniLM + cosine)

**What we do.** `useSemanticDuplication` runs paragraphs through a sidecar,
gets embeddings, feeds them into `clusterByPairwiseSimilarity` with cosine —
i.e. the exact same union-find/threshold machinery but with a semantic score.

**Is it right?**
- Yes. Cosine over sentence embeddings is the canonical way to catch
  paraphrases where lexical methods lose the pair. Multiple studies show
  Jaccard/TF-IDF underperforms embeddings on paraphrase-shaped classes;
  embeddings underperform lexical on templated / boilerplate reuse. Running
  both is the recommendation.
- MiniLM (all-MiniLM-L6-v2, 384-d) is the standard "small, cheap, good enough"
  default. It scores ~7–12% behind OpenAI `text-embedding-3-large` on MTEB
  semantic-similarity tasks, but it's free and runs client-side; that trade is
  correct for a linter that must not force a network round-trip on save.
- We already cache runs by content hash (LRU-10 in localStorage). This is the
  right primitive; you'd want to migrate to IndexedDB when a single doc's
  history crosses ~2 MB — noted in BACKLOG.

**Where it will bite us.**
- Cosine on paragraph embeddings will mark two paragraphs about "the same
  topic" as duplicates even when they're not saying the same thing
  (paraphrase != duplicate). Cross-encoder rerankers are the standard fix:
  bi-encoder retrieves the top-K candidate pairs, cross-encoder scores each
  pair jointly and re-orders. `BAAI/bge-reranker-base` is 68 MB and fits in a
  sidecar.
- Threshold 0.5 is too low for cosine over MiniLM in most tests; 0.72–0.78 is
  the usual sweet spot. Worth an ablation.

**Upgrade path.**
1. Retune the cosine threshold with a small hand-labeled set (5-10 known
   dup / non-dup pairs from real prompts).
2. Add a reranker probe for the "top-K uncertain" pairs — cheap and lifts
   precision without touching the recall pipeline.
3. Cross-encoder cost is O(K), not O(n²), so it fits our budget.

Sources:
[Sentence-transformers vs OpenAI Embeddings](https://theneuralbase.com/compare/sentence-transformers-vs-openai-embeddings/) ·
[BentoML — Best Open-Source Embedding Models 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models) ·
[BAAI/bge-reranker-base](https://huggingface.co/BAAI/bge-reranker-base) ·
[Cross-Encoder Rerankers: Higher Precision Search](https://metricgate.com/blogs/cross-encoder-reranker-search/) ·
[Using Semantic Similarity and Text Embedding to Measure Echo (arXiv)](https://arxiv.org/pdf/2303.16694)

---

## 3. Clustering — union-find over thresholded pairs

**What we do.** Build a graph of pairs above threshold, run union-find, treat
each component as a cluster; mean pairwise similarity → cluster similarity.

**Is it right?**
- For the number of paragraphs we handle, yes. Union-find over a pre-filtered
  edge set is equivalent to single-linkage clustering at a fixed cut, which
  is exactly what the literature calls "connected-components clustering."
- Single-linkage is famously prone to "chaining" (A~B, B~C, C~D but A and D
  are unrelated). At N = 250 with a 0.5 cut, chaining is rare in practice; at
  N = 10 k it's the dominant failure.

**Where it will bite us.** If we ever loosen the threshold or grow N, we'll
start seeing single mega-clusters swallow the whole document.

**Upgrade path.**
- HDBSCAN is the current standard for text clustering with embeddings — it
  uses mutual reachability distance to defeat chaining, and requires only
  `min_samples`. But it's a real dependency; not worth adding until we have a
  reason (either N > 1 k or an embedding-first mode).

Sources:
[HDBSCAN — Robust Density-Based Clustering](https://www.emergentmind.com/topics/density-based-clustering-hdbscan) ·
[Hierarchical Single-Linkage Clustering (arXiv)](https://arxiv.org/pdf/2509.02334) ·
[scikit-learn — Clustering](https://scikit-learn.org/stable/modules/clustering.html)

---

## 4. Shared-span extraction — LCS + n-grams

**What we do.** Longest common substring (DP, rolling row, ~250 k ops per pair)
between the top-similarity pair in each cluster, plus 3-5-word n-grams across
all cluster members (fallback for paraphrase clusters where no substring is
shared).

**Is it right?**
- DP-LCS is the textbook approach at O(n·m) per pair. Suffix arrays give a
  deterministic O((n+m) log(n+m)) but the constant factor only pays off when
  both strings are long **and** the pair count is high. At our sizes DP wins.
- Rolling-hash + binary search is O(n log n) but relies on hash-collision
  luck. Not worth the risk when we can afford DP.
- The n-gram fallback covers the exact paraphrase case where LCS returns
  nothing — this is the correct pattern; it's what dedup pipelines call
  "shingle overlap as a diagnostic when substring overlap is empty."

**Where it will bite us.** LCS is quadratic. A pair of 5 kB paragraphs is
25 M ops, still ms-scale, but a 50 kB pair would be a UI stutter. In practice
we never see paragraphs that long.

Sources:
[Longest Common Substring using Rolling Hash + Binary Search (OpenGenus)](https://iq.opengenus.org/longest-common-substring-using-rolling-hash/) ·
[AlgoMaster — Longest Duplicate Substring](https://algomaster.io/learn/dsa/longest-duplicate-substring)

---

## 5. Section classification — regex first, body inference as fallback

**What we do.**
- Heading / XML-tag name → canonical section via `CANONICAL_PATTERNS`
  (e.g. `\b(role|persona|you are|identity)\b`).
- Body inference: `BODY_PATTERNS` — strict opening-line patterns like
  `you are…`, `your task is…`, `rules:`, `output format`.
- Missing-sections rule now unions both.

**Is it right?**
- For headings, yes. Prompts overwhelmingly use conventional section names,
  and Anthropic's own guidance is that Claude expects a small, predictable
  set of structural cues (role, task, output format, constraints). Regex is
  fast, deterministic, offline, and matches the whole prompt-lint ecosystem's
  approach (`promptlint`, `PromptLint`, `youcommit/promptlint`, `lintlang`).
- For body inference, it works for the pattern the user hit (unheaded
  "You are…" / "Your task is…") because those openings are stereotypically
  positional. It will miss paraphrases: "As an expert…", "The goal here is…",
  "Please always…". That's the known cost of any regex classifier.

**Where it will bite us.** Every miss surfaces as a false-positive
`missing-sections` diagnostic on prompts that clearly have a role or task in
unusual wording. We saw that exact failure mode earlier.

**Upgrade path (opt-in, not default).**
- Ship the current regex classifier as tier 1.
- If tier 1 finds < 4 canonical sections, and only then, spend a single
  zero-shot LLM call on paragraphs longer than ~40 chars to classify. This
  costs one API call per unusual doc, none for well-structured ones. Cache by
  paragraph hash.
- Zero-shot classifier accuracy on 4-way tasks like this is well-studied and
  works well without few-shot; over-engineering the prompt (adding label
  descriptions) actively hurts.

Sources:
[Anthropic — Prompt Engineering Overview (via aiwithgrant)](https://www.aiwithgrant.com/guides/anthropic-prompt-engineering-overview) ·
[Claude XML Tags — 10 Tags](https://www.aipromptlibrary.app/blog/claude-xml-tags-prompt-engineering) ·
[Large Language Models Are Zero-Shot Text Classifiers (arXiv)](https://arxiv.org/pdf/2312.01044) ·
[Navigating Prompt Complexity for Zero-Shot Classification (arXiv)](https://arxiv.org/pdf/2305.14310)

---

## 6. Prompt anti-pattern rules (patterns.ts)

**What we do.** Regex counts for `MUST/CRITICAL/ALWAYS/NEVER` emphasis
inflation, `do not/don't/never/avoid` negative-only lines, `when appropriate`
etc. vague triggers, instruction stacking (bullet + imperative line counts),
and total length.

**Is each rule grounded?**

- **prompt/too-long.** Grounded. Every recent LLM eval — "context rot,"
  "distractor interference," "prompt bloat" — shows measurable degradation as
  context grows, even inside the model's window. Our warn threshold is a
  soft nudge, not a hard limit; that's the right shape.
- **prompt/instruction-stacking.** Grounded. Multiple production reports
  ("the impact of prompt bloat on LLM output quality") converge on: piling
  rules degrades per-rule attention. This is exactly the case Anthropic
  themselves make for splitting big prompts into `system` + on-demand skills.
- **prompt/critical-must-inflation.** Grounded but nuanced. The empirical
  finding is that **inflated** emphasis degrades attention (models
  over-trigger; every rule reads as top priority; downstream, contextual
  distraction hits ~45% on some benchmarks). The rule fires on excess count,
  which is the right proxy — a single MUST is fine; twelve isn't.
- **prompt/negative-only-instructions.** Grounded, with a caveat. The
  practical LLM literature says positive directives outperform negative ones
  (models suppress prohibitions less reliably than they follow "do X").
  However, a formal-alignment paper (`Via Negativa for AI Alignment`) argues
  the opposite for safety-critical constraints. The two aren't in conflict:
  our rule targets **prompt drafting**, where positive framing wins;
  RLHF-time preference data is a different regime.
- **prompt/under-specified-trigger.** Grounded. `when appropriate`,
  `when needed`, `if relevant` are canonical "vague triggers" in Anthropic's
  own anti-patterns; the recommended fix is exactly what our rule suggests.

**Verdict overall.** The ruleset aligns with what production prompt-linters
(`promptlint`, `PromptLint`, `youcommit/promptlint`) do, with our own
additions grounded in Anthropic's official guidance. The "zero API calls, zero
latency" posture is now industry standard.

**Where it can improve.**
- We don't have a rule for **XML-tag adoption on long prompts** — the single
  strongest empirical lift for Claude specifically (Anthropic's own testing
  reports 20–40% consistency gain).
- We don't have a rule for **caching-order** (static content first, variable
  content last), which the Anthropic team calls out as an up-to-90%
  cost/latency win.
- No rule for **example-block presence** on structured-output prompts, which
  every guide names as the single biggest reliability lever.

Sources:
[Anthropic — Prompt Engineering Best Practices 2025 (aakashg)](https://www.news.aakashg.com/p/prompt-engineering) ·
[Claude XML Tags — 10 Tags](https://www.aipromptlibrary.app/blog/claude-xml-tags-prompt-engineering) ·
[Morph — Context Rot: Why LLMs Degrade as Context Grows](https://www.morphllm.com/context-rot) ·
[MLOps Community — Impact of Prompt Bloat](https://mlops.community/blog/the-impact-of-prompt-bloat-on-llm-output-quality) ·
[Breaking Focus: Contextual Distraction Curse in LLMs](https://www.researchgate.net/publication/388685727_Breaking_Focus_Contextual_Distraction_Curse_in_Large_Language_Models) ·
[On the Worst Prompt Performance of LLMs (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/file/7fa5a377b7ffabcce43cd00231bb3f9c-Paper-Conference.pdf) ·
[Why Positive Prompts Outperform Negative Ones (Gadlet)](https://gadlet.com/posts/negative-prompting/) ·
[Via Negativa for AI Alignment (arXiv)](https://arxiv.org/html/2603.16417v1) ·
[promptlint (scottconverse)](https://github.com/scottconverse/promptlint) ·
[promptlint (youcommit)](https://github.com/youcommit/promptlint) ·
[PromptLint.dev](https://www.promptlint.dev/)

---

## 7. Testing / regression discipline

**What we do.** Vitest fixtures in `packages/core/src/__tests__` cover parser,
rules, engine, structure, similarity — 70 tests pass on every change to core.
No corpus-based regression suite.

**Is it right?**
- Unit tests are necessary, but the honest-to-goodness prompt-lint failure
  mode is *false positives on real prompts*. A fixture set is worth building:
  20-50 real-world prompts (public system prompts, Anthropic examples, user
  templates) with the expected diagnostic count per rule, checked in.
- Then rule changes ship with a diff of what the corpus flags. This is what
  Promptfoo does for prompts and what any lint tool does for code.

**Upgrade path.** Add `packages/core/src/__tests__/corpus/` with N real
prompts and a snapshot-style assertion of `lint(prompt).map(d => d.ruleId)`.
Freezes false-positive regressions and rule-tuning is safe.

Sources:
[Promptfoo (via Prompt Engineering 2025 guide)](https://www.news.aakashg.com/p/prompt-engineering) ·
[LaunchDarkly — Prompt Engineering Best Practices](https://launchdarkly.com/blog/prompt-engineering-best-practices/)

---

## Priority queue — what's worth doing next

Ordered by lift-per-hour, based on the above:

1. **Corpus regression tests.** Half a day. Locks in every rule tune-up we
   ship. This unblocks 1.3 in BACKLOG.
2. **Retune semantic-cosine threshold** with a small labeled set. Half a day.
   Directly cuts false-positive clusters that users will otherwise see.
3. **New rule: XML-tag adoption on long prompts.** ~2 hours. Highest-lift
   Anthropic-specific miss in our current ruleset.
4. **New rule: caching-order hint.** ~2 hours. Real cost/latency implications
   for anyone actually running the prompt.
5. **Cross-encoder reranker probe on top-K semantic pairs.** ~1 day. Kills
   the "paraphrase != duplicate" false positive without changing the pipeline.
6. **Zero-shot LLM tier-2 fallback for section classification** (only when
   tier 1 finds < 4 sections). ~1 day. Fixes the paraphrase misses the user
   already hit.

None of these are blocked on P7 (workspace loader). All of them are worth
doing before we tackle the deep-deferred items (prompt↔prompt duplication,
MiniLM upgrade, ADK lift) in BACKLOG.
