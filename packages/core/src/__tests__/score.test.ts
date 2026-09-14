import { describe, expect, it } from 'vitest'
import { scoreDiagnostics, hashContent, defaultWeights } from '../score'
import type { Diagnostic } from '../types'

const mk = (severity: Diagnostic['severity']): Diagnostic => ({
  ruleId: 'x', severity, message: '', range: { startOffset: 0, endOffset: 0 },
})

describe('scoreDiagnostics', () => {
  it('empty diagnostics = full base', () => {
    expect(scoreDiagnostics([]).score).toBe(defaultWeights.base)
  })

  it('errors deduct 10 each by default', () => {
    const r = scoreDiagnostics([mk('error'), mk('error')])
    expect(r.score).toBe(80)
    expect(r.errorCount).toBe(2)
  })

  it('mixed severities', () => {
    const r = scoreDiagnostics([mk('error'), mk('warn'), mk('warn'), mk('info')])
    expect(r.score).toBe(100 - 10 - 6 - 1)
    expect(r).toMatchObject({ errorCount: 1, warnCount: 2, infoCount: 1 })
  })

  it('floors at zero', () => {
    const ds = Array.from({ length: 20 }, () => mk('error'))
    expect(scoreDiagnostics(ds).score).toBe(0)
  })
})

describe('hashContent', () => {
  it('deterministic', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'))
  })
  it('differs for different content', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hell0'))
  })
  it('unsigned int', () => {
    expect(hashContent('anything')).toBeGreaterThanOrEqual(0)
  })
})
