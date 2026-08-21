# 05 — Cheatsheet and Templates

One page of "the moves that pay their rent," plus copy-pasteable templates
for the tasks that come up over and over.

---

## Cheatsheet

**Every prompt.**

- Role (one sentence, specific).
- Task (imperative, one paragraph or numbered list).
- Output format (state it — don't imply it via examples).
- 3–5 examples in `<example>` tags for anything non-trivial.
- Long context: content on top, question at the bottom.
- Wrap variable inputs in dedicated XML tags.
- Explain the *why* behind constraints.
- Tell the model what to do, not what not to do.

**When quality matters more than latency.**

- Chain-of-Thought (`Think through this in <thinking>` tags).
- Self-Consistency (sample N, majority vote) for discrete answers.
- Chain-of-Verification for high-stakes factual writing.

**When the task has real-world state.**

- ReAct (Thought → Action → Observation).
- Explicit "act vs. suggest" instruction.
- Parallelise independent tool calls.
- Save state to files for multi-window continuity.

**When you have retrieved documents.**

- Answer *only* from the retrieved passages.
- Force inline `[source]` citations.
- "If the sources don't cover it, say so."
- Quotes-then-answer for very long passages.

**When you're seeing failures.**

- Vague answer → add role + specificity + format.
- Wrong format → tell it what to do (not what not to do) + XML output tag.
- Hallucination → grounding + quote-first + "if you don't know, say so".
- Overengineering → explicit "minimum needed for this task" clause.
- Over-eager tool use → dial back CRITICAL/MUST → "use this when…".
- Under-eager on tools → say "Take action" not "Suggest".

**One-liners worth memorizing.**

- `"Show your prompt to a colleague with no context. If they'd be confused, the model will be too."`
- `"Put long content on top, question at the bottom."`
- `"Tell the model what to do, not what not to do."`
- `"Match your prompt style to the desired output style."`
- `"Test, don't guess."`

---

## Templates

### T1 — Universal starter

Fill in the four bracketed fields. Delete slots you don't need.

```xml
<role>[Specific persona — expertise, seniority, context]</role>

<task>
[Imperative, one paragraph. What must be produced?]
</task>

<context>
[Why this matters. Constraints. What's already been tried.]
</context>

<inputs>
[Any variable data goes here.]
</inputs>

<output_format>
[Exact shape of the response.]
</output_format>
```

### T2 — CO-STAR (audience-focused writing)

```xml
<context>[Situation. Background.]</context>
<objective>[What to produce.]</objective>
<style>[Structural — journalistic / academic / conversational…]</style>
<tone>[Emotional register — warm / confident / apologetic…]</tone>
<audience>[Who reads this and what they care about.]</audience>
<response>[Length. Format. Anything else.]</response>
```

### T3 — Classification / labeling

```xml
<task>
Classify each input into one of: [LABEL_1, LABEL_2, LABEL_3, OTHER].
</task>

<rules>
- [Positive rule 1]
- [Positive rule 2]
- Route ambiguous inputs to OTHER; do not guess.
</rules>

<do_not>
- Do not add fields to the output.
- Do not include the input in the output.
- Do not invent labels.
</do_not>

<examples>
<example>
Input: "…"
Output: {"label": "LABEL_1", "confidence": 0.92, "reason": "…"}
</example>
<example>
Input: "…"
Output: {"label": "OTHER", "confidence": 0.4, "reason": "too short"}
</example>
</examples>

<output_format>
Single JSON object: {"label": string, "confidence": 0.0-1.0, "reason": string}
</output_format>

<input>
{{INPUT}}
</input>
```

### T4 — Summarization with directional stimulus

```xml
<role>You are a policy analyst producing an executive briefing.</role>

<article>
{{ARTICLE}}
</article>

<must_reflect>
[keyword_1], [keyword_2], [keyword_3]
</must_reflect>

<output_format>
- One-sentence bottom line.
- Three bullets: what happened, why it matters, what to watch next.
- Under 120 words total.
</output_format>
```

### T5 — RAG Q&A with grounded citations

```xml
<role>
You are a research assistant. Answer only from the provided passages.
</role>

<passages>
<passage id="1" source="…">…</passage>
<passage id="2" source="…">…</passage>
</passages>

<instructions>
1. First, inside <quotes> tags, quote the passages relevant to the
   question, each tagged with [id].
2. Then, in <answer> tags, answer the question using only those quotes.
   Every factual claim must end with the matching [id].
3. If the passages do not support an answer, say
   "The provided sources don't cover this."
</instructions>

<question>
{{QUESTION}}
</question>
```

### T6 — Reasoning-heavy problem (Few-shot CoT + self-check)

```xml
<examples>
<example>
Q: [Example question]
A: [Worked chain of thought]
Final answer: [Answer]
</example>
<example>
Q: [Another example]
A: [Worked chain of thought]
Final answer: [Answer]
</example>
</examples>

<question>
{{QUESTION}}
</question>

<instructions>
Reason through the problem in <thinking> tags following the pattern
above. Then, in <verification> tags, generate two questions that would
catch a wrong answer, and answer them. Finally, in <answer> tags, state
your final answer.
</instructions>
```

### T7 — Code review

```xml
<role>
You are a staff engineer reviewing a pull request. Prefer concrete, actionable
suggestions with line references over general advice.
</role>

<diff>
{{DIFF}}
</diff>

<repo_conventions>
{{CONVENTIONS_OR_STYLE_GUIDE}}
</repo_conventions>

<instructions>
1. Read the entire diff before commenting.
2. Identify at most 5 issues, ranked by severity.
3. For each: file:line, one-sentence description, one-sentence fix.
4. If you don't see anything worth flagging, say so — don't invent issues.
</instructions>

<output_format>
Markdown table with columns: Severity | File:Line | Issue | Suggested fix
Then a one-paragraph summary.
</output_format>
```

### T8 — Extraction to structured JSON

```xml
<task>
Extract the following fields from the document below. Return only a JSON
object; no prose, no explanation.
</task>

<schema>
{
  "invoice_number": "string",
  "issue_date": "YYYY-MM-DD",
  "line_items": [
    { "description": "string", "quantity": "number", "unit_price": "number" }
  ],
  "total": "number",
  "currency": "ISO 4217 code"
}
</schema>

<rules>
- If a field is missing, use null.
- Never invent values; empty over guessed.
- Dates as YYYY-MM-DD, in the document's own timezone if any, otherwise UTC.
</rules>

<document>
{{DOCUMENT}}
</document>
```

### T9 — Agent system prompt (RISEN-shaped)

```text
Role:
You are a scheduling assistant with access to calendar_read, calendar_write,
and message_send tools.

Instructions:
Book meetings that respect everyone's stated constraints and the shared
team blackout windows.

Steps:
1. Read the requester's message and identify all attendees and hard constraints.
2. Fetch calendars for all attendees over the next 10 business days.
3. Propose the three earliest 30-min windows that satisfy all constraints.
4. Send a confirmation message with the proposed times.
5. On acceptance, create the calendar event and confirm.

End goal:
The requester gets a booked, confirmed meeting or a clearly-explained
"no viable time" response within two turns.

Narrowing:
- Do not book across shared team blackout windows.
- Do not send messages until all constraints are checked.
- Do not book meetings longer than 60 minutes without explicit permission.
- Do not attempt to modify anyone's out-of-office settings.
```

### T10 — Self-correction chain (three calls)

**Call 1 — Draft.**

```text
Produce a draft [thing]. Include everything you'd expect a final version
to have. Length: [target].
```

**Call 2 — Critique.**

```xml
<draft>
{{DRAFT_FROM_CALL_1}}
</draft>

<rubric>
1. Correctness: are all factual claims accurate?
2. Clarity: could a non-expert follow it?
3. Coverage: are the top 3 objections addressed?
4. Concision: is anything redundant?
5. Voice: does it match the target tone?
</rubric>

Score the draft on each rubric item (1–5), then list the three highest-leverage
edits.
```

**Call 3 — Refine.**

```xml
<draft>
{{DRAFT_FROM_CALL_1}}
</draft>

<critique>
{{CRITIQUE_FROM_CALL_2}}
</critique>

Rewrite the draft applying the critique. Preserve anything the critique
scored ≥ 4. Do not add new material that wasn't in the draft or requested
by the critique.
```

---

## Reusable snippets

Copy these into any system prompt as-is; they compose.

```text
<be_concrete>
Prefer concrete examples and specific numbers over generalities. When
uncertain about a value, say "unknown" rather than guess.
</be_concrete>
```

```text
<match_output_style>
Match your response style to the style of the request. Terse question →
terse answer. Bulleted request → bulleted answer. Prose request → prose.
</match_output_style>
```

```text
<parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies between
them, make all independent calls in parallel. If a later call's arguments
depend on an earlier call's result, sequence them and never use placeholders.
</parallel_tool_calls>
```

```text
<investigate_before_answering>
Never speculate about code you have not opened. If the user references a
specific file, read it before answering.
</investigate_before_answering>
```

```text
<no_over_engineering>
Only make changes that are directly requested or clearly necessary. Do not
add features, refactor, or "improve" beyond the ask. Do not add
docstrings, comments, or type annotations to code you did not change. Do
not add error handling for scenarios that cannot happen.
</no_over_engineering>
```

---

## References

- Anthropic — *Prompting best practices*:
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- Google — Lee Boonstra, *Prompt Engineering* whitepaper:
  <https://www.leeboonstra.dev/writing/write-prompting-whitepaper/>
- PromptHub — collection of applied prompting patterns:
  <https://www.prompthub.us/blog>
