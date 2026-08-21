# 01 — Fundamentals

Before any framework or fancy technique, five habits account for most of the
quality gap between a bad prompt and a good one. Master these first; they
compose with everything that comes later.

---

## 1. Be clear and direct

Modern LLMs respond well to explicit instructions. If you want "above and
beyond" behaviour, ask for it — do not rely on the model to infer it from a
vague sentence.

Anthropic's own docs put it as a golden rule: *"Show your prompt to a
colleague with minimal context on the task and ask them to follow it. If
they'd be confused, Claude will be too."*

**Less effective**

```text
Create an analytics dashboard.
```

**More effective**

```text
Create an analytics dashboard. Include as many relevant features and
interactions as possible. Go beyond the basics to create a fully-featured
implementation.
```

Two easy patterns:

- Prefer telling the model **what to do** over what not to do. `"Respond in
  smoothly flowing prose"` beats `"Do not use markdown"`.
- Use numbered lists or bullet points when order or completeness matters.

## 2. Give context — and the reason for it

State the *why* behind constraints. Models generalize from an explanation
much more reliably than from a bare rule.

**Less effective**

```text
NEVER use ellipses.
```

**More effective**

```text
Your response will be read aloud by a text-to-speech engine, so never use
ellipses since the text-to-speech engine will not know how to pronounce
them.
```

The explanation is not decoration. It lets the model make the right call in
adjacent cases you didn't think to specify (`" ... "` in a quoted excerpt,
say).

## 3. Give the model a role

Setting a role in the system prompt focuses tone, vocabulary, and defaults
for the whole conversation. Even one sentence helps.

```text
You are a helpful coding assistant specializing in Python.
```

Roles work because they anchor the model in a distribution it knows well.
Aim for specificity — `"senior data engineer reviewing SQL for a fintech
compliance audit"` outperforms `"expert"` every time.

## 4. Use examples (few-shot / multishot prompting)

Examples are the highest-leverage steering tool you have. A few well-chosen
input–output pairs teach the model your format, tone, and edge cases faster
than any prose instruction.

Make examples:

- **Relevant** — mirror the actual use case, not a toy version of it.
- **Diverse** — cover edge cases; do not leak an incidental pattern.
- **Structured** — wrap each in `<example>` tags (multiple in `<examples>`)
  so the model can tell them from your instructions.

Anthropic recommends **3–5 examples** as a sweet spot. You can also ask the
model to *evaluate* your examples for relevance and diversity, or to
*generate* additional ones from an initial seed.

Two anti-patterns to avoid (see [06-anti-patterns.md](06-anti-patterns.md)):

- **Example contamination** — an old example that contradicts current
  instructions. The single most common silent-failure source in production
  prompts.
- **Format-via-example only** — if the format matters, state it explicitly
  as well; do not rely on the model to induce it.

## 5. Structure prompts with delimiters (XML tags, fenced blocks, etc.)

When a prompt mixes instructions, context, examples, and variable inputs,
delimiters keep them separable. XML-style tags are Claude's native flavour
and generalize well to other frontier models because they were trained on
enormous amounts of HTML/XML.

```xml
<instructions>
Summarize the meeting transcript below in three bullet points, focused on
decisions and open questions.
</instructions>

<transcript>
{{TRANSCRIPT}}
</transcript>
```

Rules of thumb:

- Use consistent, descriptive tag names across a project (`<context>`,
  `<input>`, `<instructions>`, `<output_format>`).
- Nest when there is natural hierarchy (`<documents>` → `<document
  index="n">` → `<document_content>` + `<source>`).
- Triple backticks for code, quotes for short spans, XML for everything
  else. Do not over-nest — clarity beats cleverness.

Reports vary on the exact size of the effect, but the pattern-level uplift
from adding structural delimiters to a mixed prompt is consistently in the
15–20% range across independent write-ups, at essentially zero token cost.

## 6. Put long content first, question last

For prompts over ~20k tokens, put the long documents at the **top** of the
prompt and the actual question and instructions at the **bottom**. Anthropic
reports response quality can improve by up to 30% versus the reverse order,
especially on multi-document inputs.

If the input is really long, ask the model to first extract relevant
verbatim quotes (into `<quotes>` tags) and then answer using those quotes.
That grounds the answer and reduces hallucinations dramatically.

## 7. Match your prompt style to the desired output

The model imitates the register of the prompt itself. If you want flowing
prose, do not write your prompt as a bulleted checklist. If you want
concise, terse answers, do not send a rambling three-paragraph brief.

## 8. Iterate — one variable at a time

Prompting is empirical. Change one thing (a role, a delimiter, an added
example), rerun on a small held-out set, keep or revert, repeat. Save
losing variants; the ones that fail today teach you where the model is
sensitive.

---

## Quick checklist

- [ ] Would a new hire understand the prompt with no other context?
- [ ] Does every constraint come with a one-line *why*?
- [ ] Is there a specific role in the system prompt?
- [ ] Are there 3–5 relevant, diverse examples in `<example>` tags?
- [ ] Are instructions, context, and input in separate delimited blocks?
- [ ] For long inputs: content first, question last, quotes-then-answer?
- [ ] Have you told the model **what to do**, not just what to avoid?

---

## References

- Anthropic — *Prompting best practices* (Claude Platform Docs):
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Anthropic — *Prompt engineering best practices for 2026*:
  <https://claude.com/blog/best-practices-for-prompt-engineering>
- Google / Kaggle — Lee Boonstra, *Prompt Engineering* whitepaper (2024):
  <https://www.leeboonstra.dev/writing/write-prompting-whitepaper/> and PDF
  mirror <https://www.gptaiflow.com/assets/files/2025-01-18-pdf-1-TechAI-Goolge-whitepaper_Prompt%20Engineering_v4-af36dcc7a49bb7269a58b1c9b89a8ae1.pdf>
- Portkey — *Delimiters in Prompt Engineering*:
  <https://portkey.ai/blog/delimiters-in-prompt-engineering/>
- DEV Community — *XML Tags Don't Help Short Prompts — Here's When They
  Actually Matter (2026)*:
  <https://dev.to/manishramavat/xml-tags-dont-help-short-prompts-heres-when-they-actually-matter-2026-25gf>
