# 06 — Anti-Patterns

Techniques compound. So do bugs. This is the failure catalogue — the ten
things that quietly cost you quality in production prompts, and the
concrete fix for each.

---

## 1. Vague prompts

**Symptom.** Bland, generic, "on-distribution" outputs. Reads like AI slop.

**Cause.** Missing role, missing audience, missing format, missing what
success looks like.

**Fix.** Pick a framework (CO-STAR for content; RTF as a bare minimum).
Fill every slot. Would a new hire understand what you meant?

---

## 2. Instruction stacking

**Symptom.** The 12th rule in your system prompt gets ignored. Adding an
instruction makes the previous one stop working.

**Cause.** Every additional rule erodes attention on the prior ones. Past
roughly eight to ten distinct instructions, attention to any one of them
drops noticeably.

**Fix.**

- Consolidate. Two crisp rules beat five overlapping ones.
- Group with structure. Put related rules in a single `<rules>` block
  and use fewer, larger instructions.
- Move rules that never fire out of the prompt.
- Move rules that always fire into a role or a wrapper skill instead.

---

## 3. Example contamination (few-shot pollution)

**Symptom.** The model does something correct according to an old
example and wrong according to your current instructions. Silent failure
that survives review because the example looks reasonable.

**Cause.** You updated the rules but forgot to update the examples. The
model trusts the demonstrations over the prose.

**Fix.**

- Treat examples as test cases. Every rule change should be paired with
  an example diff.
- Prefer *fewer, canonical* examples over many old ones.
- Ask the model periodically: *"Does the following example contradict any
  of the rules?"* — surprisingly effective as a lint.

---

## 4. Format-via-example only

**Symptom.** The output format drifts when the input drifts.

**Cause.** You showed the format in an example and never stated it in
prose. The examples happened to share a shape the model isn't reproducing.

**Fix.** State the format explicitly (`<output_format>` block), even if
the examples show it. Belt and braces.

---

## 5. Telling the model what not to do

**Symptom.** "Do not use markdown." → markdown everywhere.

**Cause.** Negative instructions require the model to represent the
forbidden thing before suppressing it — the wrong side of that ledger
often wins.

**Fix.** Recast every "don't do X" as "do Y":

- ~~"Don't use markdown."~~ → "Write in flowing prose paragraphs."
- ~~"Don't be too formal."~~ → "Warm, conversational — like a colleague."
- ~~"No hallucinations."~~ → "Cite the source id in `[]` after every
  claim. If unsure, say `unknown`."

---

## 6. Ignoring tone and audience

**Symptom.** Output is technically right and wrong for the reader.
Executives get engineer prose, engineers get executive prose.

**Cause.** Missing audience field. Model defaults to whichever register
your prompt suggests.

**Fix.** Add a one-line audience description in CO-STAR's *Audience*
slot, and match your prompt style to your desired output style.

---

## 7. Kitchen-sink prompts

**Symptom.** One prompt does five things — a summary *and* a translation
*and* a sentiment score *and* a follow-up email *and* a JSON output.
Quality drops on all five.

**Cause.** Attention is shared across objectives.

**Fix.** Prompt chain. Separate calls per task; feed each output into
the next. Cheaper to debug and easier to evaluate.

---

## 8. Over-eager CRITICAL/MUST prompting on frontier models

**Symptom.** Tools that used to under-trigger now over-trigger. The model
runs the tool for tasks that don't need it.

**Cause.** You wrote "CRITICAL: You MUST use this tool when…" to fix an
older model's undertriggering. The new model reads that literally and
uses the tool aggressively.

**Fix.** Anthropic's own advice: dial back to normal register.
"Use this tool when…" is usually enough. Reserve emphatic language for
things that would actually cause harm otherwise.

---

## 9. Over-verification

**Symptom.** The model verifies its answer three ways for a trivial
question, ballooning latency and token cost.

**Cause.** Verification instructions carried over from prompts tuned for
older, weaker models. Newer models verify their own work well without the
prompting.

**Fix.** Remove blanket verification clauses when moving to newer
models. Re-add only where you actually need the paranoia (money, legal,
health).

---

## 10. Prompt-first culture

**Symptom.** You spend three days perfecting the prompt and one hour
deciding what "good" means.

**Cause.** Evaluation was skipped.

**Fix.**

- Write 10 concrete input-output pairs before you write the prompt.
- Every prompt change is a test-set run. Ship the version that wins on
  the eval, not the one that sounds cleverest.
- Save losing variants and their scores. They tell you where the model
  is sensitive and where it isn't.

---

## Bonus: the *right* thing done at the *wrong* altitude

Some techniques are so beloved they get applied everywhere and cost more
than they earn. Watch for:

- **CoT on every prompt.** Tokens and latency for no measurable gain on
  simple classification.
- **Self-Consistency on generation.** N samples of an open-ended draft
  is n drafts, not a voted answer.
- **XML tags on a one-sentence prompt.** Structural markup earns its
  keep on mixed-content prompts. On a two-line ask it's just noise.
- **RAG when the model already knows.** For stable, well-known
  information, RAG can *reduce* accuracy by biasing toward whatever the
  retriever surfaced.
- **Meta-prompting in production hot paths.** Great for one-offs,
  brittle at scale.

Right technique, wrong altitude is a subtle bug. If a technique costs
tokens or latency and you can't point at the metric it moves, it's
overhead.

---

## References

- DigitalApplied — *Prompt Engineering Anti-Patterns: 10 Mistakes to
  Avoid 2026*:
  <https://www.digitalapplied.com/blog/prompt-engineering-anti-patterns-10-mistakes-2026>
- KnowledgeHut — *Prompt Engineering Mistakes and How to Avoid Them*:
  <https://www.knowledgehut.com/blog/data-science/common-prompt-engineering-mistakes>
- Treyworks — *Common Prompt Engineering Mistakes to Avoid in 2026*:
  <https://treyworks.com/common-prompt-engineering-mistakes-to-avoid/>
- TechTarget — *12 prompt engineering best practices and tips*:
  <https://www.techtarget.com/searchenterpriseai/tip/Prompt-engineering-tips-and-best-practices>
- Anthropic — *Prompting best practices* (migration considerations
  covering over-eager / over-verification patterns):
  <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
