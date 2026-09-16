import type { Paragraph } from './types'

export type ExtractionTarget = 'schema' | 'tool' | 'skill'

export interface ExtractionCandidate {
  id: string
  target: ExtractionTarget
  /** One-line rationale surfaced to the user. */
  reason: string
  /** Rough regex-precision confidence: 0.6 = softer suggestion,
   *  0.9 = high-confidence. Used to sort candidates and (later) to
   *  hide low-confidence ones behind an "experimental" toggle. */
  confidence: number
  paragraphIds: string[]
  range: { startOffset: number; endOffset: number }
  /** Text the user can copy to a new tool/skill/schema file. */
  extractedSnippet: string
}

// --- Skill: paragraph opens with an explicit conditional trigger and
//     has ≥2 imperative-shaped follow-up lines. Example:
//       "If the user asks about billing, look up the account. Then
//        check subscription tier. Then respond with the tier name."
const SKILL_OPENER = /^(?:\s*[-*•]\s*)?(if|when|whenever|in case|should)\b/i
const IMPERATIVE_FOLLOWUP =
  /^\s*(?:[-*•]|\d+[.)]|[A-Z][a-z]+\s+(?:the|a|an|it|them|us)|Then\b|Next\b|First\b|Second\b|Finally\b|Always\b|Never\b|Do\b|Check\b|Look\b|Return\b|Reply\b|Respond\b|Fetch\b|Call\b|Query\b|Write\b|Set\b|Get\b|Send\b|Route\b)/

function detectSkillCandidate(p: Paragraph, idSeq: () => string): ExtractionCandidate | null {
  if (p.text.length < 120) return null
  const lines = p.text.split(/\n/).filter(l => l.trim())
  if (lines.length < 3) return null
  if (!SKILL_OPENER.test(lines[0])) return null
  const followups = lines.slice(1).filter(l => IMPERATIVE_FOLLOWUP.test(l))
  if (followups.length < 2) return null
  const openerMatch = lines[0].match(SKILL_OPENER)
  const triggerHint = openerMatch ? openerMatch[0].toLowerCase() : 'condition'
  return {
    id: idSeq(),
    target: 'skill',
    reason: `Opens with "${triggerHint} …" then ${followups.length} imperative steps — a skill triggered by that condition.`,
    confidence: 0.6,
    paragraphIds: [p.id],
    range: { startOffset: p.startOffset, endOffset: p.endOffset },
    extractedSnippet: buildSkillSnippet(p.text),
  }
}

function buildSkillSnippet(text: string): string {
  const lines = text.split(/\n/)
  const trigger = lines[0].trim()
  const body = lines.slice(1).join('\n').trim()
  return [
    '---',
    'name: extracted-skill',
    `description: ${trigger}`,
    '---',
    '',
    body,
  ].join('\n')
}

// --- Tool: paragraph has ≥3 numbered procedure lines. Deterministic
//     step-by-step behavior is the classic extract-as-tool signal.
const PROCEDURE_LINE = /^\s*\d+[.)]\s+\S/gm
const DETERMINISTIC_VERBS =
  /\b(compute|calculate|fetch|retrieve|parse|format|transform|return|save|create|generate|encode|decode|validate|sort|filter|aggregate|hash|sign|verify)\b/i

function detectToolCandidate(p: Paragraph, idSeq: () => string): ExtractionCandidate | null {
  const matches = Array.from(p.text.matchAll(PROCEDURE_LINE))
  if (matches.length < 3) return null
  const hasDeterministicVerb = DETERMINISTIC_VERBS.test(p.text)
  const confidence = hasDeterministicVerb ? 0.8 : 0.65
  return {
    id: idSeq(),
    target: 'tool',
    reason: `${matches.length}-step numbered procedure${hasDeterministicVerb ? ' with deterministic operations' : ''} — extract as a callable tool.`,
    confidence,
    paragraphIds: [p.id],
    range: { startOffset: p.startOffset, endOffset: p.endOffset },
    extractedSnippet: buildToolSnippet(p.text),
  }
}

function buildToolSnippet(text: string): string {
  const heading = text.split(/\n/, 1)[0].trim().replace(/^[\s\d.)#*-]+/, '').slice(0, 40) || 'extracted_tool'
  const nameSlug = heading.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return JSON.stringify({
    name: nameSlug || 'extracted_tool',
    description: `TODO: describe when to call. Source procedure:\n${text.trim().slice(0, 400)}`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  }, null, 2)
}

// --- Schema: paragraph whose heading (or first line) is "response
//     format" / "output format" / "json schema" AND body contains
//     JSON-shaped content. Highest-precision category.
const SCHEMA_HEADING = /^(response|output|return|reply)\s*(format|schema|shape|structure)\b/i
const SCHEMA_KEYWORD_INLINE = /\b(response|output|reply|return)\s*(format|schema|shape)\b/i
const JSON_SHAPED = /\{[\s\S]*?"[a-zA-Z_][\w-]*"[\s\S]*?:[\s\S]*?\}/
const FENCED_JSON = /```(?:json|jsonc?)\b/

function detectSchemaCandidate(p: Paragraph, idSeq: () => string): ExtractionCandidate | null {
  const firstLine = p.text.split(/\n/, 1)[0] ?? ''
  const heading = p.heading ?? firstLine
  const headingMatches = SCHEMA_HEADING.test(heading) || SCHEMA_HEADING.test(firstLine)
  const inlineMatches = SCHEMA_KEYWORD_INLINE.test(p.text.slice(0, 200))
  if (!headingMatches && !inlineMatches) return null
  const hasJsonBody = JSON_SHAPED.test(p.text) || FENCED_JSON.test(p.text)
  if (!hasJsonBody) return null
  return {
    id: idSeq(),
    target: 'schema',
    reason: 'Response-format specification with JSON-shaped body — extract as a structured output schema.',
    confidence: headingMatches ? 0.9 : 0.75,
    paragraphIds: [p.id],
    range: { startOffset: p.startOffset, endOffset: p.endOffset },
    extractedSnippet: buildSchemaSnippet(p.text),
  }
}

function buildSchemaSnippet(text: string): string {
  // Try to lift a JSON block out; fall back to the paragraph body.
  const fenced = text.match(/```(?:json|jsonc?)?\s*\n([\s\S]*?)\n```/)
  if (fenced) return fenced[1].trim()
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) return objMatch[0]
  return text.trim()
}

export function detectExtractionCandidates(paragraphs: Paragraph[]): ExtractionCandidate[] {
  const out: ExtractionCandidate[] = []
  let counter = 0
  const idSeq = () => `x${counter++}`

  for (const p of paragraphs) {
    // Precedence: schema first (highest precision), then tool, then skill.
    // A paragraph produces at most one candidate — the first that fits.
    const schema = detectSchemaCandidate(p, idSeq)
    if (schema) { out.push(schema); continue }
    const tool = detectToolCandidate(p, idSeq)
    if (tool) { out.push(tool); continue }
    const skill = detectSkillCandidate(p, idSeq)
    if (skill) { out.push(skill); continue }
  }

  return out.sort((a, b) => b.confidence - a.confidence)
}
