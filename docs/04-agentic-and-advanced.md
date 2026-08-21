# 04 — Agentic and Advanced Techniques

Once a prompt lives inside a larger system — an agent loop, a RAG pipeline,
a long-running task — the interesting variable stops being the prompt
itself and starts being everything else in the model's context. This file
covers the techniques for that regime.

---

## Context engineering (the bigger frame around prompting)

The field is quietly renaming itself. "Prompt engineering" describes the
static text you send; "context engineering" describes the whole lifecycle
of context — retrieval, curation, ordering, compaction, memory — that
determines how well any prompt actually performs.

Anthropic's guidance for agentic systems captures the shift well: LLMs
have a finite *attention budget*, and good context engineering is *"finding
the smallest possible set of high-signal tokens that maximize the
likelihood of some desired outcome"*.

Principles:

- **Right-altitude system prompts.** Not a wall of rules; not a shrug. A
  clear description of the agent's role, its tools, and how it should
  make decisions under uncertainty.
- **Diverse, canonical few-shot examples.** For an agent, few-shot is
  where you teach it the shape of the workflow, not just the shape of
  the output. Curate a small canonical set.
- **Explicit context lifecycle.** Decide what gets injected each turn,
  what stays across turns, what gets summarized, what gets dropped. If
  you don't design this, the harness makes decisions for you.
- **Structured state over compaction, when you can.** For very long
  tasks, dumping state to files (`progress.txt`, `tests.json`) and
  starting fresh contexts often outperforms compressing history in
  place.

---

## Retrieval-Augmented Generation (RAG)

RAG is the industrial-strength answer to hallucination and staleness:
retrieve the relevant snippets from an external store and put them in
the prompt so the model can answer from them instead of from memory.

A minimal RAG prompt has three sections:

```xml
<question>
{{USER_QUESTION}}
</question>

<retrieved>
<passage source="policy_2024.pdf#p14">…</passage>
<passage source="handbook.md#travel">…</passage>
</retrieved>

<instructions>
Answer the question using only the passages above. If the passages don't
support an answer, say "The provided sources don't cover this." Cite the
source id in square brackets after each factual claim.
</instructions>
```

RAG best practices:

- **Grounding-first framing.** Tell the model to answer *from* the
  retrieved passages, not to *use them as a starting point*. The
  difference matters.
- **Cite as you go.** Force `[source]` citations inline. It both
  reduces hallucinations and makes review possible.
- **Say what to do when retrieval fails.** An explicit "if the passages
  don't cover it, say so" is much better than hoping the model volunteers
  it.
- **Quotes-then-answer.** For very long passages, ask the model to first
  extract relevant verbatim quotes into a `<quotes>` block and then
  answer from the quotes.
- **Order matters.** Put passages first, question and instructions last;
  Anthropic reports up to 30% improvement on multi-document inputs.

---

## Grounding techniques (with or without RAG)

Even without retrieval infrastructure, you can push the model toward
grounded answers.

- **According-to prompting.** "According to Wikipedia, …" or "According
  to the SEC 10-K filed 2024-Q3, …". Anchors the model to a source it
  knows.
- **Direct quote extraction.** "First quote the passages relevant to the
  question inside `<quotes>` tags. Then answer using only those quotes."
- **Investigate before answering (for code).** Anthropic's own guidance
  for coding agents: "Never speculate about code you have not opened. If
  the user references a specific file, you MUST read the file before
  answering."
- **Confidence + abstain.** "If you are less than 70% confident, say
  `I don't know` rather than guess."

---

## Meta-Prompting

Meta-prompting shifts focus from *content* to *structure*. Instead of
crafting the prompt for a specific problem, you write a prompt about how
to prompt, and let the model generate the specific one.

Two productive patterns:

**1. Generate the prompt.**

```text
I want to <task>. Draft the best possible prompt for a strong LLM to
achieve this. Include a role, an objective, an output format, a few
representative examples, and any relevant edge cases I might have missed.
Then, produce the final answer using that prompt.
```

**2. Recursive Meta-Prompting.**

The model writes the prompt, executes it, critiques the result against a
rubric, and rewrites the prompt. Loop until the rubric is satisfied.

Reach for meta-prompting when you're doing a lot of one-off tasks in a
new domain and the marginal cost of hand-crafting each prompt is high.
It's *not* a replacement for a good prompt in a hot production path —
there, you want the winning prompt frozen and evaluated.

---

## Directional Stimulus Prompting

Feed the model a small set of "hint tokens" — keywords, concept anchors,
or phrases you want reflected in the output. Popularized for summarization
where you can steer what the summary emphasizes.

```text
Summarize the article below in one paragraph.

Directional stimulus (must be reflected): margin compression, hiring
freeze, guidance withdrawn, EU regulatory risk.

<article>
{{ARTICLE}}
</article>
```

Directional stimulus is the "search-with-must-include-terms" of
prompting. It works because the tokens act as attractors for the
completion — the model naturally routes through them.

---

## Generated Knowledge Prompting

Have the model generate relevant background knowledge *first*, then feed
that knowledge back in as context for the actual question.

```text
Step 1 — Generate five factual statements about <topic> that would help
answer the following question. Do not answer the question yet.

Question: <the actual question>

Step 2 — Using only those five statements, answer the question.
```

Useful for common-sense reasoning tasks where the model knows the facts
but doesn't reliably retrieve them under direct questioning. It's
essentially self-RAG — the model becomes its own knowledge store.

---

## Tool use and agents

Modern models are trained to run tools. The prompting rules that matter:

- **Be explicit about action vs. suggestion.** "Can you suggest changes"
  will get suggestions. "Change this function" will get changes.
- **Encourage parallelism where safe.** For independent tool calls, say
  so: *"If you intend to call multiple tools and there are no
  dependencies between them, make all independent calls in parallel."*
  This alone can save serial seconds per turn.
- **Sequence dependent calls carefully.** Whenever a later call's
  arguments depend on an earlier call's result, say *"do NOT call these
  in parallel."*
- **Never use placeholders in tool calls.** State this outright.
- **Watch for over-triggering.** On newer, more capable models, prompts
  designed to force under-eager older models will now cause over-eager
  behaviour. Dial back "CRITICAL: You MUST…" to "Use this tool when…".

---

## Subagent orchestration

Newer models happily spawn subagents on their own; the game is now
*curbing* them, not encouraging them. Guidance from Anthropic that
generalises:

- Have well-defined subagent tools with clear descriptions.
- Let the model orchestrate naturally.
- Watch for overuse — subagents can spawn where a direct file read or
  grep would be faster.

A useful damping prompt:

```text
Use subagents when tasks can run in parallel, require isolated context,
or involve independent workstreams that don't need to share state. For
simple tasks, sequential operations, single-file edits, or tasks where
you need to maintain context across steps, work directly rather than
delegating.
```

---

## Long-horizon workflows across multiple context windows

Techniques that make long-running agents survive context resets:

1. **Set up a scaffold in the first window.** Write tests, create a
   `progress.txt`, an `init.sh`. Never spend the first window on the
   task itself.
2. **Track structured state in files.** `tests.json` for test statuses,
   `progress.txt` for freeform notes, git for checkpoints.
3. **On restart, orient before acting.** *"Call `pwd`; you can only read
   and write files in this directory. Review `progress.txt`,
   `tests.json`, and the git log. Then run the smoke test before
   changing anything."*
4. **Prefer fresh context over compaction.** Frontier models are very
   good at re-hydrating themselves from disk. Compaction preserves
   noise; a fresh start reads only what matters.
5. **Provide verification tools.** For UI work, computer-use / browser
   tools; for code, tests and CI.

---

## Balancing autonomy and safety

If an agent can take destructive actions, spell out the reversibility
rule explicitly:

```text
Consider the reversibility and potential impact of your actions. You are
encouraged to take local, reversible actions (edit files, run tests) but
for actions that are hard to reverse, affect shared systems, or could be
destructive, confirm with the user before proceeding.

Examples that warrant confirmation:
- Destructive: deleting files/branches, dropping tables, rm -rf
- Hard to reverse: git push --force, git reset --hard, amending pushed commits
- Externally visible: pushing code, PR/issue comments, sending messages

When you hit an obstacle, do not use destructive actions as a shortcut
(no --no-verify, no discarding unfamiliar files).
```

---

## Preventing over-engineering

Frontier models often add flexibility, abstractions, defensive branches,
and comments that weren't asked for. If you want minimal solutions:

```text
Only make changes that are directly requested or clearly necessary.
- Scope: don't add features, refactor, or "improve" beyond the ask.
- Docs: don't add docstrings/comments/types to code you didn't change.
- Defensive coding: don't add error handling for scenarios that can't
  happen. Trust internal invariants. Only validate at system boundaries.
- Abstractions: don't create helpers for one-time operations. Don't
  design for hypothetical futures. Minimum needed for the current task.
```

---

## Prompt chaining as an application pattern

Chain prompts (separate API calls) when you need to inspect the
intermediate output, log it, branch on it, or feed it to a different
model. The most common productive chain is **self-correction**:

```
prompt 1 → draft
prompt 2 → review the draft against these criteria
prompt 3 → refine the draft using the review
```

Each stage runs on its own — logs, retries, and evals happen per stage
rather than inside one opaque call.

---

## References

- Anthropic — *Effective context engineering for AI agents*:
  <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Anthropic — *Prompting best practices* (agentic systems section):
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Meta-Prompting — arXiv:2311.11482:
  <https://arxiv.org/abs/2311.11482> and reference implementation
  <https://github.com/meta-prompting/meta-prompting>
- Li et al., 2023 — *Guiding Large Language Models via Directional
  Stimulus Prompting*: <https://arxiv.org/abs/2302.11520>
- Liu et al., 2021 — *Generated Knowledge Prompting for Commonsense
  Reasoning*: <https://arxiv.org/abs/2110.08387>
- IBM Think — *Directional Stimulus Prompting*:
  <https://www.ibm.com/think/topics/directional-stimulus-prompting>
- Neo4j — *Why AI teams are moving from prompt engineering to context
  engineering*:
  <https://neo4j.com/blog/agentic-ai/context-engineering-vs-prompt-engineering/>
- DataCamp — *Context Engineering: A Guide With Examples*:
  <https://www.datacamp.com/blog/context-engineering>
- Anthropic — *Reduce hallucinations* docs:
  <https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations>
- PromptHub — *Three Prompt Engineering Methods to Reduce Hallucinations*:
  <https://www.prompthub.us/blog/three-prompt-engineering-methods-to-reduce-hallucinations>
