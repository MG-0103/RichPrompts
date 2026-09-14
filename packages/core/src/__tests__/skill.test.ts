import { describe, expect, it } from 'vitest'
import { lint, badSkill } from '../index'

const ids = (ds: { ruleId: string }[]) => ds.map(d => d.ruleId)

describe('skillPack — bad fixture', () => {
  it('fires missing-trigger + missing-exclusion', () => {
    const d = lint(badSkill, 'skill')
    const seen = new Set(ids(d))
    expect(seen.has('skill/missing-trigger')).toBe(true)
    expect(seen.has('skill/missing-exclusion')).toBe(true)
  })
})

describe('skill/missing-frontmatter', () => {
  it('fires with no frontmatter', () => {
    const d = lint('# body only', 'skill').filter(x => x.ruleId === 'skill/missing-frontmatter')
    expect(d).toHaveLength(1)
  })
})

describe('skill/missing-trigger', () => {
  it('silent when description contains "when"', () => {
    const raw = '---\nname: x\ndescription: Use when the user asks about weather. Not for historical data.\n---\nbody'
    const d = lint(raw, 'skill').filter(x => x.ruleId === 'skill/missing-trigger')
    expect(d).toEqual([])
  })
})

describe('skill body reuses prompt rules', () => {
  it('runs pattern rules on body', () => {
    const raw = '---\nname: x\ndescription: Use when asked. Not for X.\n---\ncall the tool when appropriate'
    const d = lint(raw, 'skill').filter(x => x.ruleId === 'prompt/under-specified-trigger')
    expect(d).toHaveLength(1)
  })
})
