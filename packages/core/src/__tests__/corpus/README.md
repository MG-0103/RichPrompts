# Corpus & ground truth

The eval set for pipeline v2. Every gate in the phased plan
(`PIPELINE_V2_PLAN.md`) measures against this — without ground truth,
"did this change help?" is guesswork.

## Layout

```
corpus/
├── README.md              — this file
├── labels.json            — the ground truth (see schema below)
├── prompts/
│   ├── <prompt-id>.md     — one file per prompt in the corpus
│   └── ...
└── example.labels.json    — worked example showing the label format
```

Prompts are checked in as `.md` files with a short `<prompt-id>` in
kebab case (e.g. `two-agent-defs.md`, `claude-code-system.md`). The
`labels.json` file references each by that id.

## Labeling schema

Labels reference text via **anchors** (short quoted snippets that must
appear exactly once in the file), which the eval harness resolves to
character offsets at load time. Anchors survive edits — an offset
would break every time the prompt changed by a byte.

```jsonc
{
  "version": 1,
  "prompts": {
    "<prompt-id>": {
      "file": "prompts/<prompt-id>.md",
      "source": "public" | "internal" | "bug-case" | "synthesized",
      "sourceUrl": "https://...",       // for public sources
      "notes": "one-line why this prompt is in the corpus",

      // Every canonical section a human would identify, whether or
      // not it's marked by a heading. `anchor` is where the section
      // starts (inclusive); `until` is where it ends (exclusive);
      // omit `until` on the last section to run to EOF.
      "sections": [
        {
          "anchor": "# Role",
          "until": "# Task",
          "label": "role"      // role | persona | style | tone
                               // task | context | constraints
                               // output | input | reasoning
                               // guardrails | tools | skills | agents
        }
      ],

      // Pairs (or larger groups) a human agrees are duplicates —
      // same rule restated. Every text must appear exactly once in
      // the file. Merging any pair here should lose nothing.
      "duplicates": [
        {
          "texts": ["Always be polite", "Please always be polite"],
          "note": "same instruction restated"
        }
      ],

      // Pairs that state conflicting rules.
      "contradictions": [
        {
          "texts": ["always cite sources", "never cite sources"],
          "note": "always X here, never X there"
        }
      ],

      // The failure-mode cases: pairs that share vocabulary but
      // describe distinct things. Every case here MUST be labelled
      // 'not duplicate' by any correct pipeline. Regression fence
      // for the two-agent-defs bug.
      "relatedNotDuplicate": [
        {
          "texts": ["The code review agent is", "The refactor agent is"],
          "note": "two distinct agent definitions sharing 'agent' vocab"
        }
      ]
    }
  }
}
```

## Labeling conventions

**Sections.** Every section a human sees is labelled, whether or not
it has a markdown heading. When two adjacent paragraphs belong to the
same section, the section's `endOffset` covers both. When you're
genuinely unsure between two labels (role vs persona, task vs
constraints), pick the more specific one and add a `note` on the
prompt describing the ambiguity.

**Duplicates.** Two spans are duplicates if replacing both with either
one loses no information. If one span carries a qualifier the other
doesn't ("cite sources" vs "cite peer-reviewed sources"), they are
NOT duplicates — they go under `relatedNotDuplicate`.

**Contradictions.** Two spans contradict if they can't both be true.
"Always cite sources" and "never explain your reasoning" are related
but not contradictory. "Always cite sources" and "never cite sources"
contradict. Subtle overlaps ("be concise" + "explain thoroughly") are
contradictions — subtlety is what we want to catch.

**Related-not-duplicate.** The most valuable label — every case here
is a case where v1 or v2 might be tempted to merge. Include:
- Two definitions of distinct entities that share vocab (the
  two-agent-defs bug).
- Two rules on the same topic with different specificity.
- Two examples that illustrate the same rule differently.

## Sources for corpus prompts

See `PIPELINE_V2_PLAN.md` for the source strategy. Target ~25 prompts
across:

- **8-10** internal (yours; anonymized identifiers OK)
- **3-5** bug regressions (reconstructed from failures we've seen)
- **6-8** public production (Claude Code, Cline, Continue, Anthropic
  prompt library — with `sourceUrl`)
- **3-5** community collections (variety picks)
- **3** existing fixtures (`badPrompt.ts`, `goodPrompt.ts`,
  `badTool.ts`)

## Adding a new prompt

1. Save the prompt content in `prompts/<prompt-id>.md`.
2. Add an entry to `labels.json` with source metadata and empty
   sections/duplicates arrays.
3. Label the sections — that's the minimum for a prompt to count in
   the corpus.
4. Add any known duplicates / contradictions / related-not-dup pairs
   with a one-line `note` on each.
5. Run `npm run eval:v1 -- --prompt <prompt-id>` to check the current
   pipeline's output against your labels.

Labels evolve. If you disagree with a label on later review, edit
`labels.json` and note the change reason in the commit message. The
corpus is the source of truth, so its history matters.
