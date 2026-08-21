# RichPrompts

A researched, opinionated collection of prompt-writing techniques for large
language models. Each file distills a specific slice of the field into
something you can pick up and use the same day — with references to the
primary sources at the bottom of every file so you can trace any claim.

## How this repo is organized

The files are ordered from foundational to advanced. Read them in order the
first time; after that use them as a reference.

| File | What it covers |
| --- | --- |
| [`docs/01-fundamentals.md`](docs/01-fundamentals.md) | The five habits that account for most of the improvement in a prompt: clarity, specificity, context-with-reason, role, and examples. |
| [`docs/02-frameworks.md`](docs/02-frameworks.md) | Reusable prompt scaffolds — CO-STAR, RTF, CRISPE, RISEN, TIDD-EC — with when-to-use guidance and worked examples. |
| [`docs/03-reasoning.md`](docs/03-reasoning.md) | Reasoning-time techniques: chain-of-thought, self-consistency, tree of thoughts, ReAct, least-to-most, step-back, self-ask. |
| [`docs/04-agentic-and-advanced.md`](docs/04-agentic-and-advanced.md) | Context engineering, RAG, meta-prompting, directional-stimulus, generated knowledge, tool use, subagents, and long-horizon workflows. |
| [`docs/05-cheatsheet-and-templates.md`](docs/05-cheatsheet-and-templates.md) | A one-page cheatsheet plus copy-pasteable prompt templates for common tasks. |
| [`docs/06-anti-patterns.md`](docs/06-anti-patterns.md) | Common failure modes — vague prompts, instruction stacking, few-shot pollution — and how to fix each. |
| [`BEST_TECHNIQUES.md`](BEST_TECHNIQUES.md) | The consolidated, opinionated distillation. Read this if you only read one file. |
| [`docs/07-references.md`](docs/07-references.md) | Every source cited across the collection, grouped by topic. |

## Guiding beliefs

1. **The best prompt is the shortest one that reliably gets the job done.**
   Complexity is a cost, not a virtue. Start minimal; add structure only when
   the failure mode demands it.
2. **A model is a brilliant new hire with no context.** If a colleague with
   no background could follow your prompt, the model can too.
3. **Techniques compound.** A CO-STAR-structured prompt with a few-shot block
   and a chain-of-thought instruction is much stronger than any of the three
   alone.
4. **Test, don't guess.** Every technique in this repo is worth trying and
   worth measuring. Ship the one that wins on your evals, not the one that
   sounds cleverest.

## How this repo was built

Techniques were collected from Anthropic's official prompting docs, Google's
prompt-engineering whitepaper by Lee Boonstra, the DAIR.AI prompting guide,
research surveys (the Prompt Report; Meta Prompting; Least-to-Most; Tree of
Thoughts; ReAct; Self-Consistency), and vendor and community write-ups. Every
file ends with a **References** section listing the sources for that file;
the master list lives in [`docs/07-references.md`](docs/07-references.md).

## Contributing

If a technique in here doesn't hold up on your evals, that's the most useful
feedback this repo can get. Open an issue with the prompt, the task, and the
result — real disconfirmation beats a fifth framework.
