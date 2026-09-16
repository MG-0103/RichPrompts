import { describe, expect, it } from 'vitest'
import { analyzeStructure, budgetFor, estimateTokens, splitParagraphs } from '../structure'
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
