# 03 — Reasoning Techniques

Reasoning techniques target *how the model thinks*, not what it produces.
They matter when the task has more than one arithmetic-like step, when
one wrong intermediate decision cascades, or when the answer needs to be
defensible.

Modern models with adaptive thinking do a lot of this for you. Reach for
these techniques when adaptive thinking is off, when you're on a smaller
or older model, or when you specifically want the reasoning surfaced so
you can inspect it.

---

## Chain-of-Thought (CoT)

Ask the model to work through the problem step by step before it answers.

**Zero-shot CoT** — add a single instruction:

```text
Question: A juggler has 16 balls. Half are golf balls, and half of those
are blue. How many blue golf balls are there?

Let's think step by step.
```

That single line ("Let's think step by step") was the original zero-shot
CoT trigger from Kojima et al., 2022. On modern frontier models the trigger
still works, but you get more predictable structure by asking for it
explicitly:

```text
Think through this in <thinking>...</thinking> tags. Then give the final
answer in <answer>...</answer> tags.
```

**Few-shot CoT** — show a couple of worked examples where the reasoning is
written out longhand. The model imitates the pattern:

```xml
<example>
Q: Roger has 5 tennis balls. He buys 2 more cans, each with 3 balls. How many now?
A: Roger started with 5. He bought 2 cans × 3 balls = 6 more. 5 + 6 = 11. Answer: 11.
</example>

<example>
Q: A cafeteria had 23 apples. If they used 20 and bought 6 more, how many?
A: Start 23. Use 20 → 3. Buy 6 → 9. Answer: 9.
</example>

Q: A juggler has 16 balls. Half are golf balls, and half of those are blue. How many blue golf balls?
A:
```

**When to reach for it**

- Multi-step arithmetic or logic.
- Any task where the wrong first step ruins the answer.
- When you want the chain visible so you can spot the error.

**When to skip it**

- Simple lookup, extraction, translation, tagging.
- Latency-sensitive endpoints where the extra tokens are expensive.
- When adaptive thinking is on — the model is already doing this and
  extra "think step by step" text can make it overthink.

---

## Self-Consistency

Sample the model *n* times at non-zero temperature, take the majority
answer. It works because the model can reason its way to the right answer
via several different paths but rarely reasons its way to the *same
wrong* answer.

The trick is that the *reasoning* diverges but the *final answer*
converges — you keep the popular final answer and discard the chains.

**Skeleton**

```python
answers = []
for _ in range(5):
    reply = call_model(prompt, temperature=0.7)
    answers.append(extract_final_answer(reply))

final = majority(answers)
```

Cost: linear in n. Payoff: reliably better on arithmetic and reasoning
benchmarks, especially when combined with CoT. Use it when the task has a
well-defined correct answer you can vote on (numbers, class labels, yes/
no). It does *not* make sense for open-ended generation.

---

## Tree of Thoughts (ToT)

Generalises CoT from a single reasoning chain to a search tree. At each
node, the model proposes several possible next thoughts; a search
algorithm (BFS, DFS, best-first) explores them; each partial path gets
evaluated so the search can prune or backtrack.

Where CoT commits to one path, ToT keeps options open. The archetypal
example is the "Game of 24" puzzle, where ToT dramatically outperformed
plain CoT because most first moves are dead-ends and CoT has no way to
back out.

You rarely hand-implement ToT in a single prompt. Instead you drive it
from application code:

1. Prompt the model for `k` candidate next thoughts.
2. Prompt it (or a scoring function) to rate each.
3. Expand the top-scoring ones. Repeat.

Reach for ToT when the task is a search problem with a clear evaluation
signal on partial states (planning, puzzles, code generation with
compile-and-test, exploratory writing where you'll pick a winner).

Practical rule: if CoT alone is enough, use it. ToT is expensive.

---

## ReAct — Reasoning + Acting

ReAct interleaves reasoning traces (`Thought:`) with tool calls
(`Action:`) and their results (`Observation:`). It's the pattern
underneath most modern agent loops.

```text
Thought: I need to check the current stock of SKU-2210 in the SF warehouse.
Action: inventory_lookup({"sku": "SKU-2210", "warehouse": "SFO"})
Observation: {"available": 4, "reserved": 2}
Thought: Only 4 available, 2 reserved. That's below the 5-unit threshold.
        I should trigger a restock request and notify the merchant.
Action: create_restock_request({"sku": "SKU-2210", "qty": 20})
Observation: {"restock_id": "R-118"}
Thought: Now notify the merchant.
Action: send_message({"to": "merchant-2210", "template": "low-stock-notice"})
```

ReAct is powerful because the observations correct the model in-flight —
it can revise its reasoning after every tool call. It's the default
pattern for anything involving lookups, calculations, or real-world state.

For long-running agents, pair ReAct with:

- A **state file** the agent can read/write between actions (progress
  notes, tests.json).
- A rule to **plan then act** — one paragraph of thinking every `N`
  actions to prevent tunnel vision.

---

## Least-to-Most Prompting

Explicitly decompose the problem into sub-problems, solve them in order,
each sub-answer feeding the next. Two stages:

1. **Decomposition** — "List the sub-questions you need to answer to solve
   this."
2. **Sequential solving** — solve each sub-question in order, carrying
   forward the answers.

```text
Problem: Emma has three times as many marbles as Liam. Together they have
   48. How many does each have?

Step 1 — Decompose. What sub-questions must we answer?
   a) Let x = Liam's marbles. What is Emma's in terms of x?
   b) What equation follows from "together they have 48"?
   c) Solve for x.
   d) Compute Emma's count.

Step 2 — Solve each in turn.
   a) Emma has 3x.
   b) x + 3x = 48.
   c) 4x = 48 → x = 12.
   d) Emma has 3·12 = 36.

Answer: Liam 12, Emma 36.
```

Least-to-most reliably beats CoT when the problem is *harder than the
examples you gave*. Combine with CoT for the biggest wins (each sub-step
reasoned out).

---

## Step-Back Prompting

Before you ask the model to solve the specific problem, ask it to name
the general principle at play.

```text
Question: What was the population of country X in year Y?

Step-back: Before you answer, ask and answer the more general
question — "What sources typically report country-level population by
year, and how are they estimated?"

Then answer the original question, citing which type of source you'd
trust here.
```

The abstraction step tames a lot of confident-but-wrong answers because
the model self-locates in the right knowledge neighborhood before diving
in. Very effective for physics, chemistry, legal reasoning, and
knowledge-heavy questions.

---

## Self-Ask

The model decomposes a question into follow-up sub-questions, answers
each (optionally by tool call), and only then answers the top-level
question.

```text
Question: Who was president of the country that hosted the 2016 Summer
Olympics at the time of those Olympics?

Follow-up 1: Which country hosted the 2016 Summer Olympics?
Intermediate answer: Brazil.

Follow-up 2: Who was president of Brazil in August 2016?
Intermediate answer: Michel Temer (acting after Rousseff's suspension).

Final answer: Michel Temer.
```

Self-Ask is the "human" way of thinking through a compound factual
question and is a good building block for ReAct-style tool use.

---

## Chain-of-Verification (CoVe)

After the model produces a draft, ask it to generate verification
questions targeting the parts most likely to be wrong. Answer those
questions independently. If any disagree with the draft, revise.

```text
1. Draft answer.
2. From the draft, generate 3–5 verification questions whose answers,
   if wrong, would invalidate the draft.
3. Answer each verification question fresh, without looking at the draft.
4. Compare. Revise the draft to reconcile disagreements.
```

Reported gains of up to 23% on some hallucination benchmarks. Cheap to
add to any high-stakes writing task.

---

## When each technique earns its cost

| Technique | Extra tokens | Use when |
| --- | --- | --- |
| Chain-of-Thought | 1× | Multi-step reasoning, answer defensibility |
| Few-shot CoT | 1× + examples | You have exemplars of the reasoning style |
| Self-Consistency | n× | Discrete answer, clear voting metric |
| Tree of Thoughts | n·d× | Real search problems with partial-state evaluation |
| ReAct | linear in tool calls | Any task that needs external state |
| Least-to-Most | ~2× | Task is harder than any single example |
| Step-Back | small | Knowledge-heavy questions; anti-hallucination |
| Self-Ask | small | Compound factual questions |
| Chain-of-Verification | ~2× | High-stakes factual writing |

Rule of thumb: layer techniques rather than swap them. `Few-shot CoT +
Self-Consistency` is a workhorse for reasoning tasks. `ReAct + a state
file + Chain-of-Verification` is a workhorse for agents.

---

## References

- Wei et al., 2022 — *Chain-of-Thought Prompting Elicits Reasoning in
  Large Language Models*: <https://arxiv.org/abs/2201.11903>
- Kojima et al., 2022 — *Large Language Models are Zero-Shot Reasoners*
  ("Let's think step by step"): <https://arxiv.org/abs/2205.11916>
- Wang et al., 2022 — *Self-Consistency Improves Chain of Thought
  Reasoning in Language Models*: <https://arxiv.org/abs/2203.11171>
- Yao et al., 2023 — *Tree of Thoughts: Deliberate Problem Solving with
  Large Language Models*: <https://arxiv.org/abs/2305.10601>
- Yao et al., 2022 — *ReAct: Synergizing Reasoning and Acting in Language
  Models*: <https://arxiv.org/abs/2210.03629>
- Zhou et al., 2022 — *Least-to-Most Prompting Enables Complex Reasoning
  in Large Language Models*: <https://arxiv.org/abs/2205.10625>
- Zheng et al., 2023 — *Take a Step Back: Evoking Reasoning via Abstraction
  in LLMs*: <https://arxiv.org/abs/2310.06117>
- Press et al., 2022 — *Measuring and Narrowing the Compositionality Gap
  in Language Models* (Self-Ask): <https://arxiv.org/abs/2210.03350>
- Dhuliawala et al., 2023 — *Chain-of-Verification Reduces Hallucination
  in Large Language Models*: <https://arxiv.org/abs/2309.11495>
- Google — Lee Boonstra, *Prompt Engineering* whitepaper, chapters on
  chain-of-thought, self-consistency, ToT, ReAct.
- Anthropic — *Prompting best practices*, section on thinking & reasoning:
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
