import { describe, expect, it } from 'vitest'
import {
  analyzeStructure,
  budgetFor,
  detectDuplicationClusters,
  detectExtractionCandidates,
  detectNoise,
  estimateTokens,
  longestCommonSubstring,
  sharedPhrases,
  splitParagraphs,
} from '../structure'
import { parseDocument } from '../parser'

describe('estimateTokens', () => {
  it('is roughly chars/4', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(4)).toBe(1)
    expect(estimateTokens(400)).toBe(100)
  })
})

describe('budgetFor', () => {
  it('reports tone based on percent used', () => {
    const under = budgetFor(4000, 'claude-sonnet-5')  // ~1000t / 40000t → 2.5%
    expect(under.tone).toBe('good')
    const over = budgetFor(200_000, 'claude-sonnet-5') // ~50000t / 40000t → 125%
    expect(over.tone).toBe('bad')
  })

  it('falls back to a sensible default for unknown models', () => {
    const b = budgetFor(10_000, 'unknown-model-xyz')
    expect(b.practicalTokens).toBeGreaterThan(0)
    expect(b.model).toBe('unknown-model-xyz')
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines and preserves offsets', () => {
    const raw = 'first line\nof paragraph one.\n\nsecond paragraph.\n\nthird.'
    const parsed = parseDocument(raw, 'prompt')
    const ps = splitParagraphs(raw, parsed.sections)
    expect(ps).toHaveLength(3)
    expect(ps[0].text.startsWith('first line')).toBe(true)
    expect(raw.slice(ps[1].startOffset, ps[1].endOffset)).toBe('second paragraph.')
  })

  it('tags paragraphs with their canonical section', () => {
    const raw = '# Role\n\nYou are helpful.\n\n# Task\n\nAnswer questions.\n'
    const parsed = parseDocument(raw, 'prompt')
    const ps = splitParagraphs(raw, parsed.sections)
    const role = ps.find(p => p.text.includes('helpful'))
    const task = ps.find(p => p.text.includes('Answer'))
    expect(role?.section).toBe('role')
    expect(task?.section).toBe('task')
  })
})

describe('detectNoise', () => {
  it('flags HTML comments, author markers, placeholders, empty tags, blank runs', () => {
    const raw = [
      '<!-- author note about revision -->',
      'TODO: come back to this later',
      'The value is [REDACTED] currently.',
      '<x></x>',
      '',
      '',
      '',
      'more content',
    ].join('\n')
    const flags = detectNoise(raw, [])
    const kinds = new Set(flags.map(f => f.kind))
    expect(kinds.has('html-comment')).toBe(true)
    expect(kinds.has('author-marker')).toBe(true)
    expect(kinds.has('placeholder')).toBe(true)
    expect(kinds.has('empty-xml-tag')).toBe(true)
    expect(kinds.has('blank-run')).toBe(true)
  })

  it('flags a boilerplate tail when a Role section is already present', () => {
    const raw = '# Role\n\nYou are an expert code reviewer.\n\n' +
      'Do the analysis.\n\n' +
      'You are a helpful assistant. Be polite.'
    const parsed = parseDocument(raw, 'prompt')
    const flags = detectNoise(raw, parsed.sections)
    const boilerplate = flags.find(f => f.kind === 'boilerplate-tail')
    expect(boilerplate).toBeDefined()
    expect(boilerplate!.message).toMatch(/helpful assistant/i)
  })

  it('does NOT double-fire on overlapping matches (author marker inside HTML comment)', () => {
    const raw = '<!-- TODO: fix later -->'
    const flags = detectNoise(raw, [])
    // Only the outer html-comment should survive de-dupe
    expect(flags.filter(f => f.kind === 'html-comment')).toHaveLength(1)
    expect(flags.filter(f => f.kind === 'author-marker')).toHaveLength(0)
  })
})

describe('detectDuplicationClusters', () => {
  it('finds a cluster of two near-verbatim paragraphs', () => {
    const raw = [
      'Always respond in JSON. Never use markdown. If the user asks a question, answer directly.',
      '',
      'Some other unrelated content about cats and dogs and the weather report.',
      '',
      'Always answer in JSON. Never use markdown formatting. If asked a question, answer directly.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const clusters = detectDuplicationClusters(paragraphs)
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    expect(clusters[0].paragraphIds.length).toBeGreaterThanOrEqual(2)
    expect(clusters[0].similarity).toBeGreaterThan(0.5)
  })

  it('returns no clusters when all paragraphs are unique', () => {
    const raw = [
      'The mitochondria is the powerhouse of the cell.',
      '',
      'Please always list the ingredients before writing the recipe.',
      '',
      'Refuse to answer questions about proprietary financial data.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const clusters = detectDuplicationClusters(paragraphs)
    expect(clusters).toHaveLength(0)
  })

  it('populates sharedText via LCS when members share a verbatim run', () => {
    const raw = [
      'Always respond in JSON with keys kind, message, and followups. No markdown allowed.',
      '',
      'Please always respond in JSON with keys kind, message, and followups. No emojis either.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const clusters = detectDuplicationClusters(paragraphs, { threshold: 0.35 })
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    expect(clusters[0].sharedText.length).toBeGreaterThanOrEqual(25)
    expect(clusters[0].sharedText.toLowerCase()).toContain('respond in json')
  })

  it('marks clusters as crossSection when members span canonical sections', () => {
    const raw = [
      '# Task',
      'Always respond in JSON with keys kind, message, and followups.',
      '',
      '# Constraints',
      'Always respond in JSON. Include kind, message, and followups.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const clusters = detectDuplicationClusters(paragraphs, { threshold: 0.35 })
    const cross = clusters.find(c => c.crossSection)
    expect(cross).toBeDefined()
  })
})

describe('longestCommonSubstring', () => {
  it('finds the longest shared run, normalizing whitespace', () => {
    const a = 'Always respond in JSON.   Never use markdown.'
    const b = 'Also please always respond in JSON. Emojis are ok.'
    expect(longestCommonSubstring(a, b).toLowerCase()).toContain('respond in json')
  })
  it('returns empty string when nothing meaningful matches', () => {
    expect(longestCommonSubstring('cat', 'dog')).toBe('')
  })
})

describe('sharedPhrases', () => {
  it('finds phrases that appear in ≥ 2 texts', () => {
    const texts = [
      'always output json when the user asks',
      'always output json unless the user says otherwise',
      'unrelated content about the weather',
    ]
    const phrases = sharedPhrases(texts)
    expect(phrases.some(p => p.includes('always output json'))).toBe(true)
  })
  it('returns an empty list when nothing repeats', () => {
    const texts = ['alpha beta gamma delta', 'foo bar baz qux']
    expect(sharedPhrases(texts)).toEqual([])
  })
})

describe('detectExtractionCandidates', () => {
  it('flags a schema candidate when a response-format heading has JSON body', () => {
    const raw = [
      '# Response format',
      '',
      'The output must be a JSON object with these keys:',
      '```json',
      '{ "kind": "string", "message": "string", "followups": [] }',
      '```',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const candidates = detectExtractionCandidates(paragraphs)
    const schema = candidates.find(c => c.target === 'schema')
    expect(schema).toBeDefined()
    expect(schema!.confidence).toBeGreaterThanOrEqual(0.75)
    expect(schema!.extractedSnippet).toMatch(/kind/)
  })

  it('flags a tool candidate for a numbered procedure with 3+ steps', () => {
    const raw = [
      'How to compute the invoice total:',
      '1. Fetch the line items for the invoice.',
      '2. Calculate the subtotal by summing line item costs.',
      '3. Apply tax and return the final total.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const candidates = detectExtractionCandidates(paragraphs)
    const tool = candidates.find(c => c.target === 'tool')
    expect(tool).toBeDefined()
    // Deterministic verbs raise confidence
    expect(tool!.confidence).toBeGreaterThanOrEqual(0.8)
    expect(tool!.extractedSnippet).toMatch(/"name"/)
  })

  it('flags a skill candidate for IF-block + imperative follow-ups', () => {
    const raw = [
      'If the user asks about billing, do the following steps carefully:',
      'Look up the account details for the customer identifier.',
      'Check the subscription tier and current plan status.',
      'Respond with a summary of the tier and next billing date.',
    ].join('\n')
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const candidates = detectExtractionCandidates(paragraphs)
    const skill = candidates.find(c => c.target === 'skill')
    expect(skill).toBeDefined()
    expect(skill!.extractedSnippet).toMatch(/name: extracted-skill/)
  })

  it('returns no candidates for plain prose without procedural or IF patterns', () => {
    const raw =
      'You are a general-purpose assistant. Respond in a friendly tone.\n' +
      'Do not disclose personal information unless the user asks first.'
    const parsed = parseDocument(raw, 'prompt')
    const paragraphs = splitParagraphs(raw, parsed.sections)
    const candidates = detectExtractionCandidates(paragraphs)
    expect(candidates).toHaveLength(0)
  })
})

describe('analyzeStructure', () => {
  it('aggregates chars per section and computes fractions', () => {
    const raw = [
      '# Role',
      'You are a routing agent.',
      '',
      '# Task',
      'Answer user queries.',
      'Do it quickly.',
      '',
      '# Constraints',
      'Never leak PII.',
      'Always respond in JSON.',
      'No markdown.',
    ].join('\n')
    const r = analyzeStructure(raw, 'prompt', { model: 'claude-sonnet-5' })
    expect(r.chars).toBe(raw.length)
    expect(r.sections.length).toBeGreaterThanOrEqual(3)
    // Fractions sum to ~1 (minus non-section chars, e.g., heading lines themselves)
    const total = r.sections.reduce((a, s) => a + s.fraction, 0)
    expect(total).toBeGreaterThan(0.5)
    expect(total).toBeLessThanOrEqual(1)
    // Sections are ordered by document position
    for (let i = 1; i < r.sections.length; i++) {
      expect(r.sections[i].startOffset).toBeGreaterThanOrEqual(r.sections[i - 1].startOffset)
    }
    // Budget is populated
    expect(r.budget.model).toBe('claude-sonnet-5')
    expect(r.budget.approxTokens).toBe(estimateTokens(raw.length))
  })
})
