import type { Diagnostic, ParsedDoc, Rule, Section } from '../types'

const TRIGGER_HINTS = [/\bwhen\b/i, /\btrigger\b/i, /\buse (?:this|when|for)\b/i, /\bload (?:this|when)\b/i]
const EXCLUSION_HINTS = [/don't use/i, /do not use/i, /not for/i, /avoid/i, /except/i]

function findDescriptionSection(doc: ParsedDoc): Section | null {
  const fm = doc.sections.find(s => s.kind === 'frontmatter')
  if (!fm) return null
  const m = fm.text.match(/description:\s*([\s\S]*?)(?:\n\S|$)/)
  if (!m) return null
  const rel = fm.text.indexOf(m[1])
  return {
    kind: 'frontmatter',
    name: 'description',
    text: m[1].trim(),
    startOffset: fm.startOffset + rel,
    endOffset: fm.startOffset + rel + m[1].length,
  }
}

const missingTrigger: Rule = {
  id: 'skill/missing-trigger',
  pack: 'skill',
  defaultSeverity: 'warn',
  appliesTo: ['skill'],
  docsRef: 'docs/04-agentic-and-advanced.md § Skill triggers',
  check(doc) {
    const desc = findDescriptionSection(doc)
    if (!desc) return []
    if (TRIGGER_HINTS.some(re => re.test(desc.text))) return []
    return [
      {
        ruleId: 'skill/missing-trigger',
        severity: 'warn',
        message: `Skill description has no explicit trigger ('when X', 'use for Y', 'triggered by Z'). Model must infer.`,
        range: { startOffset: desc.startOffset, endOffset: desc.endOffset },
        fix: `Add a sentence: "Use when …" or "Load this skill when …".`,
      },
    ]
  },
}

const missingSkillExclusion: Rule = {
  id: 'skill/missing-exclusion',
  pack: 'skill',
  defaultSeverity: 'info',
  appliesTo: ['skill'],
  check(doc) {
    const desc = findDescriptionSection(doc)
    if (!desc) return []
    if (EXCLUSION_HINTS.some(re => re.test(desc.text))) return []
    return [
      {
        ruleId: 'skill/missing-exclusion',
        severity: 'info',
        message: `Skill description names positive triggers but no exclusions. Overlapping skills will collide.`,
        range: { startOffset: desc.startOffset, endOffset: desc.endOffset },
        fix: `Add: "Do not use for …".`,
      },
    ]
  },
}

const missingFrontmatter: Rule = {
  id: 'skill/missing-frontmatter',
  pack: 'skill',
  defaultSeverity: 'error',
  appliesTo: ['skill'],
  check(doc) {
    if (doc.sections.some(s => s.kind === 'frontmatter')) return []
    return [
      {
        ruleId: 'skill/missing-frontmatter',
        severity: 'error',
        message: `Skill file has no frontmatter block. name/description are required.`,
        range: { startOffset: 0, endOffset: Math.min(doc.raw.length, 1) },
        fix: `Prepend: ---\\nname: my-skill\\ndescription: …\\n---`,
      },
    ]
  },
}

export const skillRules: Rule[] = [missingFrontmatter, missingTrigger, missingSkillExclusion]

export const _internal = { findDescriptionSection }
export type _t = Diagnostic
