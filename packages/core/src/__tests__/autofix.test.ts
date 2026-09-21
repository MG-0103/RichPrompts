import { describe, expect, it } from 'vitest'
import {
  applyDiagnosticFix,
  fixMissingSections,
  fixUndefinedVariable,
  isDiagnosticFixable,
  lint,
} from '../index'

describe('fixUndefinedVariable', () => {
  it('adds a name under an existing variables: block', () => {
    const src =
      '---\n' +
      'name: greeter\n' +
      'variables:\n' +
      '  - a\n' +
      '---\n' +
      'Hello {{b}}\n'
    const out = fixUndefinedVariable(src, 'b')
    expect(out).toContain('- a')
    expect(out).toContain('- b')
    expect(out.indexOf('- a')).toBeLessThan(out.indexOf('- b'))
  })

  it('creates a variables: block when the frontmatter has none', () => {
    const src = '---\nname: greeter\n---\nHi {{name}}\n'
    const out = fixUndefinedVariable(src, 'name')
    expect(out).toMatch(/variables:\n\s*-\s*name/)
  })

  it('creates a whole frontmatter block when the doc has none', () => {
    const src = 'Hello {{name}}\n'
    const out = fixUndefinedVariable(src, 'name')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('variables:')
    expect(out).toContain('- name')
    expect(out).toContain('Hello {{name}}')
  })

  it('is idempotent when the variable is already declared', () => {
    const src = '---\nvariables:\n  - name\n---\nHi {{name}}\n'
    expect(fixUndefinedVariable(src, 'name')).toBe(src)
  })

  it('refuses invalid identifiers (no injection surface)', () => {
    const src = '---\nvariables:\n  - a\n---\n'
    expect(fixUndefinedVariable(src, 'a\n  malicious: true')).toBe(src)
  })
})

describe('fixMissingSections', () => {
  it('inserts headings at the top when there is no frontmatter', () => {
    const src = 'Some prose only.\n'
    const out = fixMissingSections(src, ['role', 'task'])
    expect(out.startsWith('## Role')).toBe(true)
    expect(out).toContain('## Task')
    expect(out).toContain('Some prose only.')
    expect(out.indexOf('## Role')).toBeLessThan(out.indexOf('## Task'))
  })

  it('inserts after the frontmatter block', () => {
    const src = '---\nname: x\n---\nBody.\n'
    const out = fixMissingSections(src, ['constraints'])
    const bodyStart = out.indexOf('## Constraints')
    expect(bodyStart).toBeGreaterThan(out.indexOf('---\n---'))
    expect(out).toContain('Body.')
  })

  it('emits headings in canonical order regardless of input order', () => {
    const out = fixMissingSections('body', ['constraints', 'role'])
    expect(out.indexOf('## Role')).toBeLessThan(out.indexOf('## Constraints'))
  })

  it('is a no-op when nothing is missing', () => {
    const src = '## Role\n\nA\n'
    expect(fixMissingSections(src, [])).toBe(src)
  })
})

describe('applyDiagnosticFix via lint() end-to-end', () => {
  it('fixes an undefined-variable diagnostic from the linter', () => {
    const src =
      '---\n' +
      'variables:\n' +
      '  - a\n' +
      '---\n' +
      '# Role\nYou are helpful.\n# Task\nDo X.\n# Output Format\nJSON.\n# Constraints\nBe kind.\nUse {{missing}} carefully.\n'
    const diags = lint(src, 'prompt')
    const undef = diags.find(d => d.ruleId === 'prompt/undefined-variable')
    expect(undef).toBeDefined()
    expect(isDiagnosticFixable(undef!)).toBe(true)
    const out = applyDiagnosticFix(src, undef!)
    const rerun = lint(out, 'prompt')
    expect(rerun.some(d => d.ruleId === 'prompt/undefined-variable')).toBe(false)
  })

  it('fixes a missing-sections diagnostic from the linter', () => {
    const src = 'Some content without headings.\n'
    const diags = lint(src, 'prompt')
    const miss = diags.find(d => d.ruleId === 'prompt/missing-sections')
    expect(miss).toBeDefined()
    expect(isDiagnosticFixable(miss!)).toBe(true)
    const out = applyDiagnosticFix(src, miss!)
    const rerun = lint(out, 'prompt')
    expect(rerun.some(d => d.ruleId === 'prompt/missing-sections')).toBe(false)
  })
})
