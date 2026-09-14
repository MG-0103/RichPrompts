import { describe, expect, it } from 'vitest'
import { lint, badTool } from '../index'

const ids = (ds: { ruleId: string }[]) => ds.map(d => d.ruleId)

describe('toolPack — bad fixture', () => {
  it('fires weak-verb, missing-exclusion, missing-example, vague-param', () => {
    const d = lint(badTool, 'tool')
    const seen = new Set(ids(d))
    expect(seen.has('tool/weak-verb')).toBe(true)
    expect(seen.has('tool/missing-exclusion')).toBe(true)
    expect(seen.has('tool/missing-example')).toBe(true)
    expect(seen.has('tool/vague-param')).toBe(true)
  })
})

describe('tool/vague-param', () => {
  it('flags short description', () => {
    const raw = JSON.stringify({
      name: 'x', description: 'Fetch the current weather. Example: x()',
      parameters: { type: 'object', properties: { q: { type: 'string', description: 'q' } } },
    }, null, 2)
    const d = lint(raw, 'tool').filter(x => x.ruleId === 'tool/vague-param')
    expect(d).toHaveLength(1)
  })

  it('flags missing type', () => {
    const raw = JSON.stringify({
      name: 'x', description: 'Fetch the current weather in a city. Example: x()',
      parameters: { type: 'object', properties: { q: { description: 'city name in ISO 3166 form' } } },
    }, null, 2)
    const d = lint(raw, 'tool').filter(x => x.ruleId === 'tool/vague-param')
    expect(d).toHaveLength(1)
  })

  it('silent when full', () => {
    const raw = JSON.stringify({
      name: 'x', description: 'Fetch weather. Example: x(). Not for historical data.',
      parameters: { type: 'object', properties: { q: { type: 'string', description: 'city name in ISO 3166 form' } } },
    }, null, 2)
    const d = lint(raw, 'tool').filter(x => x.ruleId === 'tool/vague-param')
    expect(d).toEqual([])
  })
})

describe('tool/name-description-mismatch', () => {
  it('fires when name tokens absent from description', () => {
    const raw = JSON.stringify({
      name: 'search_web', description: 'Fetch data. Example: x()',
      parameters: { type: 'object', properties: {} },
    }, null, 2)
    const d = lint(raw, 'tool').filter(x => x.ruleId === 'tool/name-description-mismatch')
    expect(d).toHaveLength(1)
  })

  it('silent when overlap present', () => {
    const raw = JSON.stringify({
      name: 'search_web', description: 'Search the web. Example: search_web(q=…). Not for local files.',
      parameters: { type: 'object', properties: {} },
    }, null, 2)
    const d = lint(raw, 'tool').filter(x => x.ruleId === 'tool/name-description-mismatch')
    expect(d).toEqual([])
  })
})
