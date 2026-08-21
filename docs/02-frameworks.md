# 02 — Prompt Frameworks

A framework is a reusable scaffold — a small set of slots you fill in so you
don't forget the parts that actually move quality. None of them are magic.
Their value is that they force you to specify the thing you were about to
leave implicit.

Pick one framework per task class and use it consistently. Switching
frameworks mid-project trains no one and helps nothing.

---

## The five frameworks worth knowing

| Framework | Slots | Best for |
| --- | --- | --- |
| **RTF** | Role, Task, Format | Fast, single-shot asks |
| **CO-STAR** | Context, Objective, Style, Tone, Audience, Response | Communication-heavy work: marketing copy, docs, presentations, client-facing writeups |
| **CRISPE** | Capacity/Role, Insight, Statement, Personality, Experiment | Exploratory work where you want multiple takes |
| **RISEN** | Role, Instructions, Steps, End goal, Narrowing | Multi-step procedural / enterprise tasks with constraints |
| **TIDD-EC** | Task, Instructions, Do, Don't, Examples, Context | Content ops and moderation-style work |

---

## RTF — the minimum viable framework

**R**ole · **T**ask · **F**ormat.

Fast, easy to remember, hard to abuse. Use it when you don't need much
context and just want a solid one-shot answer.

```text
Role:   You are a senior tax accountant familiar with the US–India tax
        treaty.
Task:   Explain to me how foreign tax credit works for Indian equity
        dividends held via a US brokerage.
Format: A short memo — one paragraph of context, then a bulleted list of
        the practical steps I have to take at filing time.
```

Anytime you find yourself writing a prompt with no role and no format,
switching to RTF is a free win.

---

## CO-STAR — the communication framework

**C**ontext · **O**bjective · **S**tyle · **T**one · **A**udience ·
**R**esponse.

Developed by Singapore's GovTech team, CO-STAR won first place in
Singapore's 2023 GPT-4 prompt engineering competition and has since become
the default framework for anything the model will produce for a specific
audience — marketing copy, executive summaries, launch emails, PR drafts,
support macros.

Its edge is the split between **Style** (structural — journalistic,
academic, narrative) and **Tone** (emotional register — formal, warm,
apologetic). Most prompts collapse these into one and get muddled output.

**Template**

```xml
<context>
Our SaaS product is a mid-market HR platform. Our biggest competitor just
raised prices; several of our customers are asking whether we plan to
follow.
</context>

<objective>
Draft an email to affected customers explaining that our pricing is
staying flat for the next 12 months.
</objective>

<style>
Concise business memo. Short paragraphs, no bullet lists, no headings.
</style>

<tone>
Confident and warm — not defensive, not gloating.
</tone>

<audience>
HR directors and CFOs at 200–2,000-person companies. Time-poor, skeptical
of vendor spin.
</audience>

<response>
120–160 words, ready to send. Include a subject line and a one-line
sign-off.
</response>
```

---

## CRISPE — the exploratory framework

**C**apacity & role · **I**nsight · **S**tatement · **P**ersonality ·
**E**xperiment.

CRISPE's distinctive move is the **Experiment** slot: you explicitly ask
for multiple takes and let the model surface variants you would not have
prompted for. Great for naming, taglines, headline testing, positioning,
early ideation.

**Template**

```text
Capacity & role:
You are a naming consultant who has shipped launches for four
Y-Combinator-backed developer-tools companies.

Insight:
Developer-tool names that stick tend to be either (a) an evocative common
noun repurposed (Bolt, Anvil, Cursor) or (b) a short invented word with
one soft consonant (Vercel, Retool, Prisma).

Statement:
Propose names for a new open-source library that lets you diff two API
schemas and generate migration code.

Personality:
Playful but credible — this will go on a landing page next to serious
enterprise trust signals.

Experiment:
Give me three names in category (a), three in category (b), and one
wildcard. For each, one-sentence rationale plus a domain suggestion.
```

---

## RISEN — the procedural framework

**R**ole · **I**nstructions · **S**teps · **E**nd goal · **N**arrowing.

RISEN's contribution is the last two slots. **End goal** stops the model
producing correct-but-useless work by making the point of the task
explicit. **Narrowing** is your out-of-scope list — the things not to
include, not to do, not to talk about.

Use it for playbooks, runbooks, migration guides, standard operating
procedures, and system prompts for narrowly-scoped agents.

**Template**

```text
Role:
You are a senior SRE writing a runbook.

Instructions:
Produce a runbook for responding to a spike in 5xx errors from our
checkout service.

Steps:
1. Identify the blast radius (which regions, which merchants).
2. Confirm whether the spike correlates with a deploy in the last 60m.
3. Decide between rollback, feature-flag disable, or scale-up.
4. Communicate to #status and to affected merchants.
5. Post-incident: file a followup and schedule a review.

End goal:
An on-call engineer with two months' tenure can execute this runbook
alone at 3am and reach a resolved-or-escalated state within 20 minutes.

Narrowing:
Do not include tooling this team doesn't own (no DataDog UI clicks; we
use Grafana). Do not recommend paging the CTO. Do not include any
customer-communication templates — that's a separate doc.
```

---

## TIDD-EC — the content-ops framework

**T**ask · **I**nstructions · **D**o · **D**on't · **E**xamples ·
**C**ontext.

Purpose-built for content moderation, classification, and any workflow
that needs positive rules, negative rules, and worked examples in the same
prompt. The explicit `Do:` and `Don't:` sections read as if they were
written for a rubric — which is a good sign.

```text
Task:
Classify each incoming support ticket into: BILLING, TECHNICAL,
ACCOUNT_ACCESS, or OTHER.

Instructions:
Read the ticket, then output a single JSON object of the form
{"category": "...", "confidence": 0.0-1.0, "reason": "..."}.

Do:
- Route ambiguous ticket text to OTHER, do not guess.
- Use ACCOUNT_ACCESS for password / MFA / SSO issues even if worded as
  "billing".
- Set confidence < 0.6 when the ticket text is under 10 words.

Don't:
- Do not add extra keys to the JSON.
- Do not include the original ticket text in the output.
- Do not use categories other than the four listed.

<examples>
<example>
Ticket: "Charged twice this month, please refund."
Output: {"category": "BILLING", "confidence": 0.95, "reason": "explicit duplicate charge"}
</example>
<example>
Ticket: "I can't log in — my SSO code isn't arriving."
Output: {"category": "ACCOUNT_ACCESS", "confidence": 0.9, "reason": "SSO delivery failure"}
</example>
</examples>

<context>
This runs on inbound webhook, ~50k tickets/day. False positives on BILLING
create noise for our finance team; err toward OTHER when uncertain.
</context>
```

---

## Which framework should I pick?

- **Just need an answer, fast?** — RTF.
- **Producing content for a specific audience?** — CO-STAR.
- **Exploring or ideating?** — CRISPE.
- **Multi-step procedure with constraints?** — RISEN.
- **Classification / moderation / rules-heavy content ops?** — TIDD-EC.

You do not need to memorize five frameworks. Learn one you'll use daily
(CO-STAR is the safest default), and pull up the others by name when a
particular task really is that shape.

---

## References

- KnowledgeHut — *Prompt Engineering Frameworks: RTF, CRISPE & CO-STAR*:
  <https://www.knowledgehut.com/blog/artificial-intelligence/prompt-engineering-frameworks-rtf-crispe-costar>
- Promptary — *CO-STAR Prompt Framework: Complete Guide with Examples
  (2026)*: <https://promptary.dev/frameworks/costar/>
- GovTech Singapore — *Mastering the art of prompt engineering with
  Empower* (origin of CO-STAR):
  <https://www.tech.gov.sg/technews/mastering-the-art-of-prompt-engineering-with-empower/>
- Denys Dinkevych — *CRISPE — ChatGPT Prompt Engineering Framework*:
  <https://sourcingdenis.medium.com/crispe-prompt-engineering-framework-e47eaaf83611>
- ClickUp — *RISEN: 5 Steps to Build Context-Rich AI Prompts*:
  <https://clickup.com/general-resources/playbooks/ai-prompts>
- PromptQuorum — *RISEN Framework: Multi-Step Enterprise Workflows*:
  <https://www.promptquorum.com/frameworks/risen>
- Prompt Architects — *The 7 ChatGPT Prompt Frameworks Every Power User
  Knows (2026)*:
  <https://prompt-architects.com/blog/06-7-chatgpt-prompt-frameworks>
