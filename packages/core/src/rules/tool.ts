import type { Diagnostic, Rule } from '../types'
import type { ParsedTool } from '../toolParser'

const WEAK_VERBS = ['process', 'handle', 'manage', 'do', 'perform', 'execute']
const EXCLUSION_HINTS = [/don't use/i, /do not use/i, /not for/i, /avoid when/i, /except when/i, /unless/i]
const EXAMPLE_HINTS = [/example:/i, /e\.g\./i, /for example/i]
const MIN_PARAM_DESC = 20

function asTool(doc: unknown): ParsedTool {
  return doc as ParsedTool
}

const weakVerb: Rule = {
  id: 'tool/weak-verb',
  pack: 'tool',
  defaultSeverity: 'warn',
  appliesTo: ['tool'],
  docsRef: 'docs/01-fundamentals.md § 1 (Be clear and direct)',
  check(doc) {
    const t = asTool(doc)
    if (!t.toolDescription || !t.toolDescriptionRange) return []
    const firstWord = t.toolDescription.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '')
    if (!firstWord || !WEAK_VERBS.includes(firstWord)) return []
    return [
      {
        ruleId: 'tool/weak-verb',
        severity: 'warn',
        message: `Description opens with weak verb '${firstWord}'; state the concrete action.`,
        range: { startOffset: t.toolDescriptionRange[0], endOffset: t.toolDescriptionRange[1] },
        fix: `Rewrite as an active, specific verb (e.g. 'Search…', 'Fetch…', 'Compute…').`,
      },
    ]
  },
}

const missingExclusion: Rule = {
  id: 'tool/missing-exclusion',
  pack: 'tool',
  defaultSeverity: 'info',
  appliesTo: ['tool'],
  docsRef: 'docs/04-agentic-and-advanced.md § Tool descriptions',
  check(doc) {
    const t = asTool(doc)
    if (!t.toolDescription || !t.toolDescriptionRange) return []
    if (EXCLUSION_HINTS.some(re => re.test(t.toolDescription!))) return []
    return [
      {
        ruleId: 'tool/missing-exclusion',
        severity: 'info',
        message: `Description states when to use the tool but never when NOT to. Sibling tools with overlapping verbs will over-trigger.`,
        range: { startOffset: t.toolDescriptionRange[0], endOffset: t.toolDescriptionRange[1] },
        fix: `Add a sentence: "Do not use for …" or "Not for …".`,
      },
    ]
  },
}

const missingExample: Rule = {
  id: 'tool/missing-example',
  pack: 'tool',
  defaultSeverity: 'info',
  appliesTo: ['tool'],
  check(doc) {
    const t = asTool(doc)
    if (!t.toolDescription || !t.toolDescriptionRange) return []
    if (EXAMPLE_HINTS.some(re => re.test(t.toolDescription!))) return []
    return [
      {
        ruleId: 'tool/missing-example',
        severity: 'info',
        message: `Description has no example invocation.`,
        range: { startOffset: t.toolDescriptionRange[0], endOffset: t.toolDescriptionRange[1] },
        fix: `Add "Example: search_web(query='…')" or similar.`,
      },
    ]
  },
}

const _WORD = /[A-Za-z]{3,}/g
const STOP = new Set(['the','a','an','and','or','to','for','with','of','in','on','use','this','that','when','not','from','tool'])

const nameDescMismatch: Rule = {
  id: 'tool/name-description-mismatch',
  pack: 'tool',
  defaultSeverity: 'warn',
  appliesTo: ['tool'],
  check(doc) {
    const t = asTool(doc)
    if (!t.toolName || !t.toolDescription || !t.toolDescriptionRange) return []
    const nameTokens = t.toolName.toLowerCase().split(/[_\W]+/).filter(w => w.length >= 3 && !STOP.has(w))
    if (nameTokens.length === 0) return []
    const descWords = new Set(Array.from(t.toolDescription.toLowerCase().matchAll(_WORD), m => m[0]))
    if (nameTokens.some(t => descWords.has(t))) return []
    return [
      {
        ruleId: 'tool/name-description-mismatch',
        severity: 'warn',
        message: `Description shares no content word with tool name '${t.toolName}'. Likely stale on one side.`,
        range: { startOffset: t.toolDescriptionRange[0], endOffset: t.toolDescriptionRange[1] },
        fix: `Align the wording between name and description.`,
      },
    ]
  },
}

const vagueParam: Rule = {
  id: 'tool/vague-param',
  pack: 'tool',
  defaultSeverity: 'warn',
  appliesTo: ['tool'],
  check(doc) {
    const t = asTool(doc)
    const out: Diagnostic[] = []
    for (const p of t.params) {
      const reasons: string[] = []
      if (!p.description || p.description.length < MIN_PARAM_DESC) reasons.push(`description <${MIN_PARAM_DESC} chars`)
      if (!p.type) reasons.push('missing type')
      if (reasons.length === 0) continue
      out.push({
        ruleId: 'tool/vague-param',
        severity: 'warn',
        message: `Param '${p.name}': ${reasons.join(', ')}.`,
        range: { startOffset: p.nameOffset, endOffset: p.nameEnd },
        fix: `Add a full sentence describing what '${p.name}' means, its type, format, and units.`,
      })
    }
    return out
  },
}

export const toolRules: Rule[] = [weakVerb, missingExclusion, missingExample, nameDescMismatch, vagueParam]
