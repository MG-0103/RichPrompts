# The Best Prompt-Writing Techniques

The consolidated, opinionated distillation. If you only read one file in
this repo, read this one.

Everything below is drawn from the source-cited chapters in
[`docs/`](docs/) — this file is where the trade-offs are made, the
rankings are asserted, and the "if you had to pick just one" calls get
answered.

---

## The one-page principle

> **A prompt is a specification.** Everything that separates a good prompt
> from a bad one is the specification getting sharper: sharper role,
> sharper task, sharper constraints, sharper examples, sharper output
> contract. Techniques are just standard moves for making a specification
> sharper faster.

Almost every quality problem you'll see traces back to under-specification.
Almost every latency and cost problem traces back to over-specification.
Prompt engineering is calibration, not incantation.

---

## The seven techniques that pay for themselves everywhere

Ranked by how consistently they lift real-world outputs. If you're only
adopting a few habits, adopt these — in this order.

### 1. Give the model a specific role

`"You are a senior data engineer reviewing SQL for a fintech compliance
audit"` outperforms `"You are an expert"` every time. Roles anchor the
model in a distribution it knows well and shape defaults for tone,
vocabulary, and rigor for the whole conversation. Single most reliable
one-line quality lift.

### 2. State the output format explicitly

*Do not* imply the format via examples alone. Say it in prose:
`"Respond as a JSON object with keys 'label' (string), 'confidence'
(0.0–1.0), and 'reason' (string). No prose."` Then, if you want, show
examples. The format instruction stops silent drift when inputs change.

### 3. Put the "why" behind every constraint

`"NEVER use ellipses"` is a rule the model will follow narrowly.
`"Your response will be read aloud by a text-to-speech engine, so never
use ellipses — the engine can't pronounce them"` is a principle the model
will generalise. State the reason once; save yourself ten follow-up rules.

### 4. Show 3–5 examples in `<example>` tags

Few-shot prompting is the fastest way to teach format, tone, and edge-case
handling. Anthropic's own guidance: 3–5 examples, relevant, diverse,
structured. Wrap each in `<example>` tags. Diverse enough that the model
does not lock onto an incidental pattern; canonical enough that they
represent the workflow.

### 5. Structure prompts with XML tags

When a prompt mixes instructions, context, examples, and inputs, put each
in its own tag (`<instructions>`, `<context>`, `<input>`,
`<output_format>`). Reported ~15–20% uplift at essentially zero token
cost, generalises across frontier models, and — critically — makes the
prompt reviewable by a human.

### 6. Long content first, question last

For prompts over ~20k tokens: documents at the top, question and
instructions at the bottom. Up to 30% improvement reported on multi-
document inputs. Cheapest reordering fix in the field.

### 7. Tell the model what to do, not what to avoid

`"Do not use markdown"` fails. `"Write in flowing prose paragraphs"`
works. Negative instructions require the model to represent the forbidden
thing before suppressing it. Recast every prohibition as a positive
directive.

---

## When the task is hard: reasoning

Add these when the task has multiple dependent steps, or the answer needs
to be defensible.

### Chain-of-Thought (CoT)

The one reasoning move worth learning. Ask the model to think in
`<thinking>` tags before answering in `<answer>` tags. On modern models
with adaptive thinking, this is often already happening internally — but
making it explicit surfaces the chain for you to inspect. Zero-shot CoT
still works ("Let's think step by step"); few-shot CoT — where you show a
worked reasoning example — is stronger.

### Self-Consistency (when the answer is discrete)

Sample the model N times at non-zero temperature and take the majority.
Works when the final answer is votable: a number, a class label, a
yes/no. Do not use it on open-ended generation — N drafts is not a
voted answer, it's N drafts.

### ReAct (when the task has real-world state)

Interleave `Thought → Action → Observation`. The observations correct
the model in-flight. This is the default pattern for anything that needs
lookups, calculations, or tool calls.

### Chain-of-Verification (when the stakes are high)

After the model produces a draft, have it generate verification
questions targeting the parts most likely to be wrong, answer each
independently, then reconcile with the draft. Up to ~23% hallucination
reduction reported. Cheap to add to any high-stakes factual writing task.

### The tree-of-thoughts trap

Tree of Thoughts is real and it works, but it earns its keep only when
the task is a genuine search problem with a clear evaluation signal on
partial states — planning, puzzles, code with compile-and-test. Do not
reach for it as a default. If CoT is enough, stop.

---

## When the task is knowledge-heavy: grounding

Add these when the failure mode is confidently-wrong facts.

### Answer only from the sources (RAG framing)

If you're feeding retrieved documents in, say so directly: *"Answer only
from the passages below. Cite the source id in `[]` after each factual
claim. If the passages don't support an answer, say 'The provided sources
don't cover this.'"* Framing decides half the outcome — "answer from" is
much stronger than "use these as a starting point."

### Quotes-then-answer

For long context, ask the model to first extract relevant verbatim
quotes into `<quotes>` tags, then answer using only those quotes. Grounds
the reasoning, and makes review possible.

### According-to prompting

`"According to the SEC 10-K filed 2024-Q3, …"` anchors the model to a
source it recognises. ~20% accuracy lift reported.

### Investigate before answering (for code)

For coding agents: *"Never speculate about code you have not opened.
If the user references a specific file, read it before answering."* Turns
a hallucination bug into a tool call.

### Confidence + abstain

Explicit permission to say "I don't know" beats gentle hints. `"If you
are less than 70% confident, say 'unknown' rather than guess."`

---

## The compound moves (technique combinations that punch above their weight)

Prompt techniques compound. These are the pairs and triples that
consistently outperform their parts.

- **Role + Format + `<example>` block.** The universal starter for any
  content generation task. If you do nothing else, do this.
- **CO-STAR + few-shot.** Communication tasks (marketing, docs, PR).
  CO-STAR fixes the ambiguity in tone/audience/format; the examples pin
  down the style.
- **Few-shot CoT + Self-Consistency.** The workhorse for reasoning
  problems with a votable answer.
- **RAG + Quotes-then-answer + Inline citations.** Q&A over documents,
  minimum viable.
- **ReAct + state files + Chain-of-Verification.** Long-running agents
  that need to survive context resets *and* be trusted.
- **Self-correction chain: Draft → Critique → Refine.** Three cheap
  calls, huge quality lift on writing tasks, and each stage can be
  logged and evaluated independently.

---

## The moves that hurt more than they help

Techniques that are worth naming so you can *not* reach for them by
reflex.

- **CRITICAL/MUST prompting on frontier models.** Yesterday's fix for
  under-triggering is today's cause of over-triggering. Dial back to
  "Use this tool when…"
- **Chain-of-Thought on trivial tasks.** Tokens for no measurable gain.
  Do not add "think step by step" to classification prompts.
- **Instruction stacking past ~8–10 rules.** Attention on each rule
  drops. Consolidate; move never-firing rules out; group with structure.
- **Blanket verification instructions.** Newer models verify their own
  work well. Verification instructions carried over from older prompts
  balloon latency and tokens for no gain.
- **XML tags on one-sentence prompts.** Structural markup earns its keep
  on mixed-content prompts. On a two-line ask it's noise.
- **RAG when the model already knows.** For stable, well-known facts, RAG
  can *reduce* accuracy by biasing toward whatever the retriever
  surfaced.
- **Meta-prompting in a production hot path.** Great for one-offs.
  Brittle at scale. Freeze the winning prompt; evaluate it.

---

## Context engineering: the bigger frame

Once your prompt lives in a system — an agent loop, a RAG pipeline, a
multi-turn assistant — the useful frame is *context engineering*, not
prompt engineering. Anthropic's framing captures the shift:

> Good context engineering is finding the smallest possible set of
> high-signal tokens that maximize the likelihood of some desired
> outcome, given that LLMs are constrained by a finite attention budget.

Four principles that follow from this:

1. **Right-altitude system prompts.** Not a wall of rules; not a shrug.
   Enough for the model to make decisions under uncertainty.
2. **Diverse canonical few-shot examples.** For an agent, few-shot teaches
   the *shape of the workflow*, not just the shape of the output.
3. **Explicit context lifecycle.** Decide what enters, what stays, what
   compacts, what dies. If you don't design this, the harness picks for
   you.
4. **Structured state over compaction.** For long tasks, dumping state to
   files (`progress.txt`, `tests.json`) and starting fresh contexts
   often beats compressing history in place.

---

## The universal starter template

The one prompt scaffold to reach for when you don't know what else to
reach for. Fill in the four brackets; delete slots you don't need.

```xml
<role>
[Specific persona — expertise, seniority, context]
</role>

<task>
[Imperative. One paragraph or numbered list of what must be produced.]
</task>

<context>
[Why this matters. Who reads it. Constraints. What's already been tried.]
</context>

<inputs>
[Any variable data, in nested tags if there's structure.]
</inputs>

<examples>
<example>[3–5 examples of the desired input→output pattern.]</example>
</examples>

<output_format>
[Exact shape. Length. Any negative-space constraints.]
</output_format>
```

This template is not the answer. Answering the *four bracketed questions*
seriously is the answer.

---

## The ten-item checklist before you ship a prompt

1. Would a colleague with no context understand it?
2. Is the role specific enough to change the tone and defaults?
3. Is the output format stated in prose (not just implied by examples)?
4. Does every constraint carry its "why"?
5. Are examples relevant, diverse, and current with the rules?
6. For long inputs: content up top, question at the bottom?
7. Does the failure path have a rule ("if you can't, say 'unknown'")?
8. Have you told the model what to do rather than what not to do?
9. Did you remove instructions that duplicate the model's defaults?
10. Have you actually run it on 10 held-out examples before shipping?

---

## The two questions that resolve most debates

When someone on your team wants to add a technique to a prompt, ask them:

1. **What failure did we just see on the evals that this technique
   addresses?**
2. **What are we willing to pay in tokens and latency for the fix?**

If (1) is not concrete or (2) is not measured, decline the change. Every
technique in this repo is real — and every one of them is dead weight in
a prompt that didn't need it.

---

## References

This file is a distillation of the source-cited chapters:

- [`docs/01-fundamentals.md`](docs/01-fundamentals.md)
- [`docs/02-frameworks.md`](docs/02-frameworks.md)
- [`docs/03-reasoning.md`](docs/03-reasoning.md)
- [`docs/04-agentic-and-advanced.md`](docs/04-agentic-and-advanced.md)
- [`docs/05-cheatsheet-and-templates.md`](docs/05-cheatsheet-and-templates.md)
- [`docs/06-anti-patterns.md`](docs/06-anti-patterns.md)
- [`docs/07-references.md`](docs/07-references.md) — the full source list.

Primary sources that shaped this file specifically:

- Anthropic — *Prompting best practices* and *Effective context
  engineering for AI agents*.
- Google — Lee Boonstra, *Prompt Engineering* whitepaper (v4).
- Wei et al., 2022 — *Chain-of-Thought Prompting*.
- Wang et al., 2022 — *Self-Consistency*.
- Yao et al., 2022/2023 — *ReAct* and *Tree of Thoughts*.
- Zhou et al., 2022 — *Least-to-Most Prompting*.
- Zheng et al., 2023 — *Step-Back Prompting*.
- Dhuliawala et al., 2023 — *Chain-of-Verification*.
- Schulhoff et al., 2024 — *The Prompt Report* (systematic survey).
- Suzgun & Kalai, 2023 — *Meta-Prompting*.
- GovTech Singapore — origin of the CO-STAR framework.

Every URL for each of the above lives in
[`docs/07-references.md`](docs/07-references.md).
