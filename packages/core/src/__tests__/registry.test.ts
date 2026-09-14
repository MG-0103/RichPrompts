import { describe, expect, it } from 'vitest'
import {
  buildRegistry,
  runRegistryRules,
  sampleRegistryTools,
  sampleRegistrySkills,
  similarity,
} from '../index'

describe('similarity', () => {
  it('identical strings ~= 1', () => {
    expect(similarity('search the web', 'search the web')).toBeCloseTo(1, 2)
  })
  it('disjoint strings low', () => {
    expect(similarity('read a file from disk', 'send an email')).toBeLessThan(0.15)
  })
  it('near-paraphrase high', () => {
    expect(similarity('Search the web for a query', 'Search the public web for a term')).toBeGreaterThan(0.35)
  })
})

describe('runRegistryRules — sample fixture', () => {
  const registry = buildRegistry(sampleRegistryTools, sampleRegistrySkills)
  const findings = runRegistryRules(registry)

  it('flags overlapping tool pair', () => {
    const hit = findings.find(f =>
      f.docIds.includes('tool:search_web') && f.docIds.includes('tool:web_query'))
    expect(hit).toBeDefined()
    expect(hit!.score).toBeGreaterThan(0.5)
  })

  it('flags overlapping skill pair', () => {
    const hit = findings.find(f =>
      f.docIds.includes('skill:weather-lookup') && f.docIds.includes('skill:weather-forecast'))
    expect(hit).toBeDefined()
  })

  it('does not flag read_file against search_web', () => {
    const hit = findings.find(f =>
      f.docIds.includes('tool:read_file') && f.docIds.includes('tool:search_web'))
    expect(hit).toBeUndefined()
  })

  it('sorted by descending score', () => {
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i - 1].score).toBeGreaterThanOrEqual(findings[i].score)
    }
  })
})
