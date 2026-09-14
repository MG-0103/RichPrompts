import type { Diagnostic, Rule, RuleContext } from '../types'

const promptTooLong: Rule = {
  id: 'prompt/too-long',
  pack: 'prompt',
  defaultSeverity: 'warn',
  appliesTo: ['prompt'],
  docsRef: 'docs/06-anti-patterns.md § 2 (Instruction stacking)',
  check(doc, ctx) {
    const max = ctx.config.thresholds.promptMaxChars
    if (doc.raw.length <= max) return []
    return [
      {
        ruleId: 'prompt/too-long',
        severity: 'warn',
        message: `Prompt is ${doc.raw.length.toLocaleString()} chars (>${max.toLocaleString()}); per-rule attention degrades at this length.`,
        range: { startOffset: max, endOffset: doc.raw.length },
        fix: 'Compress or split into a lean system prompt plus on-demand skills.',
        docsRef: 'docs/06-anti-patterns.md § 2 (Instruction stacking)',
      },
    ]
  },
}

const STACKING_RE = /^[ \t]*(?:[-*+]|\d+[.)]|(?:MUST|SHOULD|NEVER|DO NOT|DON'T|ALWAYS)\b)/gim

const instructionStacking: Rule = {
  id: 'prompt/instruction-stacking',
  pack: 'prompt',
  defaultSeverity: 'warn',
  appliesTo: ['prompt', 'skill'],
  docsRef: 'docs/06-anti-patterns.md § 2 (Instruction stacking)',
  check(doc, ctx) {
    const max = ctx.config.thresholds.instructionStackingMax
    const hits = Array.from(doc.raw.matchAll(STACKING_RE))
    if (hits.length <= max) return []
    return [
      {
        ruleId: 'prompt/instruction-stacking',
        severity: 'warn',
        message: `Prompt contains ~${hits.length} rule-like lines (>${max}); attention on any single rule drops.`,
        range: { startOffset: 0, endOffset: Math.min(doc.raw.length, 1) },
        fix: 'Consolidate related rules, group under headings, or move rarely-firing rules into on-demand skills.',
        docsRef: 'docs/06-anti-patterns.md § 2 (Instruction stacking)',
      },
    ]
  },
}

const EMPHATIC_RE = /\b(CRITICAL|IMPORTANT|MUST|MANDATORY|ALWAYS|NEVER|DO NOT|DON'T)\b/g

const criticalMustInflation: Rule = {
  id: 'prompt/critical-must-inflation',
  pack: 'prompt',
  defaultSeverity: 'info',
  appliesTo: ['prompt', 'skill', 'tool'],
  docsRef: "docs/06-anti-patterns.md § 8 (Over-eager CRITICAL/MUST prompting)",
  check(doc, ctx) {
    const max = ctx.config.thresholds.emphaticTokensMax
    const out: Diagnostic[] = []
    const hits = Array.from(doc.raw.matchAll(EMPHATIC_RE))
    if (hits.length <= max) return out
    for (const m of hits) {
      if (m.index === undefined) continue
      out.push({
        ruleId: 'prompt/critical-must-inflation',
        severity: 'info',
        message: `Emphatic token '${m[0]}' — ${hits.length} total (>${max}); frontier models over-trigger on inflated emphasis.`,
        range: { startOffset: m.index, endOffset: m.index + m[0].length },
        fix: "Reserve emphatic language for harm-critical rules; downgrade the rest to 'Use this when …'.",
        docsRef: "docs/06-anti-patterns.md § 8 (Over-eager CRITICAL/MUST prompting)",
      })
    }
    return out
  },
}

const NEG_LINE_RE = /^[ \t]*(?:[-*+][ \t]+)?(do not|don't|never|avoid|no)\b/gim

const negativeInstructions: Rule = {
  id: 'prompt/negative-only-instructions',
  pack: 'prompt',
  defaultSeverity: 'info',
  appliesTo: ['prompt', 'skill'],
  docsRef: 'docs/06-anti-patterns.md § 5 (Telling the model what not to do)',
  check(doc, ctx) {
    const max = ctx.config.thresholds.negativeInstructionsMax
    const out: Diagnostic[] = []
    const hits = Array.from(doc.raw.matchAll(NEG_LINE_RE))
    if (hits.length <= max) return out
    for (const m of hits) {
      if (m.index === undefined) continue
      out.push({
        ruleId: 'prompt/negative-only-instructions',
        severity: 'info',
        message: `Prohibition '${m[1]}' — ${hits.length} total (>${max}); models suppress prohibited things less reliably than they follow positive directives.`,
        range: { startOffset: m.index, endOffset: m.index + m[0].length },
        fix: "Recast 'Don't X' as 'Do Y' where possible.",
        docsRef: 'docs/06-anti-patterns.md § 5 (Telling the model what not to do)',
      })
    }
    return out
  },
}

const VAGUE_TRIGGER_RE = /\bwhen (?:appropriate|needed|necessary|possible|helpful|relevant)\b/gi

const underSpecifiedTrigger: Rule = {
  id: 'prompt/under-specified-trigger',
  pack: 'prompt',
  defaultSeverity: 'info',
  appliesTo: ['prompt', 'skill', 'tool'],
  docsRef: 'docs/06-anti-patterns.md § 1 (Vague prompts)',
  check(doc, _ctx: RuleContext) {
    const out: Diagnostic[] = []
    for (const m of doc.raw.matchAll(VAGUE_TRIGGER_RE)) {
      if (m.index === undefined) continue
      out.push({
        ruleId: 'prompt/under-specified-trigger',
        severity: 'info',
        message: `Vague trigger '${m[0]}'; the model has to guess what that means.`,
        range: { startOffset: m.index, endOffset: m.index + m[0].length },
        fix: "Replace with an explicit condition: 'when X', 'if the user has already Y'.",
        docsRef: 'docs/06-anti-patterns.md § 1 (Vague prompts)',
      })
    }
    return out
  },
}

export const patternRules: Rule[] = [
  promptTooLong,
  instructionStacking,
  criticalMustInflation,
  negativeInstructions,
  underSpecifiedTrigger,
]
