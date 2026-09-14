import { describe, expect, it } from 'vitest'
import { parseDocument } from '../parser'

describe('parseDocument', () => {
  it('captures markdown headings with offsets', () => {
    const raw = '# Role\nyou are helpful\n# Task\ndo the thing\n'
    const doc = parseDocument(raw)
    const headings = doc.sections.filter(s => s.kind === 'heading')
    expect(headings.map(h => h.name)).toEqual(['Role', 'Task'])
    expect(raw.slice(headings[0].startOffset, headings[0].startOffset + 6)).toBe('# Role')
  })

  it('extracts frontmatter block', () => {
    const raw = '---\nvariables:\n  - x\n---\nbody\n'
    const doc = parseDocument(raw)
    const fm = doc.sections.find(s => s.kind === 'frontmatter')
    expect(fm).toBeDefined()
    expect(fm!.text).toContain('variables:')
  })

  it('captures xml tags', () => {
    const raw = '<role>helper</role>'
    const doc = parseDocument(raw)
    const xml = doc.sections.filter(s => s.kind === 'xml')
    expect(xml).toHaveLength(1)
    expect(xml[0].name).toBe('role')
    expect(xml[0].text).toBe('helper')
  })

  it('collects template variables uniquely', () => {
    const raw = 'hi {{name}} and {{name}} again {{other}}'
    const doc = parseDocument(raw)
    expect(doc.variables.sort()).toEqual(['name', 'other'])
  })
})
