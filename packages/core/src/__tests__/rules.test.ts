import { describe, expect, it } from 'vitest'
import { lint, defaultConfig, badPrompt, goodPrompt } from '../index'

const ids = (ds: { ruleId: string }[]) => ds.map(d => d.ruleId)

describe('promptRules — bad fixture', () => {
  it('fires missing-sections + vague qualifier signals', () => {
    const diagnostics = lint(badPrompt)
    expect(ids(diagnostics)).toContain('prompt/missing-sections')
  })
})

describe('promptRules — good fixture', () => {
  it('does not fire structural or pattern errors', () => {
    const diagnostics = lint(goodPrompt)
    const errors = diagnostics.filter(d => d.severity === 'error')
    expect(errors).toEqual([])
    expect(ids(diagnostics)).not.toContain('prompt/missing-sections')
    expect(ids(diagnostics)).not.toContain('prompt/missing-data-delimiter')
  })
})

describe('undefined-variable', () => {
  it('silent when no frontmatter present (opt-in declaration)', () => {
    const raw = 'hello {{name}}'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/undefined-variable')
    expect(d).toEqual([])
  })

  it('flags undeclared var when frontmatter exists', () => {
    const raw = '---\nvariables:\n  - other\n---\nhi {{name}}'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/undefined-variable')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
  })

  it('accepts var declared in frontmatter', () => {
    const raw = '---\nvariables:\n  - name\n---\nhi {{name}}'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/undefined-variable')
    expect(d).toEqual([])
  })
})

describe('missing-data-delimiter', () => {
  it('fires when interpolation lacks input tag', () => {
    const raw = '---\nvariables:\n  - x\n---\nsummarize {{x}}'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/missing-data-delimiter')
    expect(d).toHaveLength(1)
  })

  it('silent when <input> present', () => {
    const raw = '---\nvariables:\n  - x\n---\n<input>{{x}}</input>'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/missing-data-delimiter')
    expect(d).toEqual([])
  })

  it('silent with markdown "# Input" heading', () => {
    const raw = '# Input\n{{x}}'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/missing-data-delimiter')
    expect(d).toEqual([])
  })

  it('silent with fenced code block', () => {
    const raw = 'do stuff\n```\n{{x}}\n```\n'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/missing-data-delimiter')
    expect(d).toEqual([])
  })
})

describe('critical-must-inflation', () => {
  it('fires when emphatic tokens exceed threshold', () => {
    const raw = 'MUST do X. NEVER do Y. CRITICAL: check Z. IMPORTANT thing. MANDATORY.'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/critical-must-inflation')
    expect(d.length).toBeGreaterThan(0)
  })

  it('silent under threshold', () => {
    const raw = 'You MUST verify.'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/critical-must-inflation')
    expect(d).toEqual([])
  })
})

describe('under-specified-trigger', () => {
  it('flags "when appropriate"', () => {
    const raw = 'call the tool when appropriate'
    const d = lint(raw).filter(x => x.ruleId === 'prompt/under-specified-trigger')
    expect(d).toHaveLength(1)
  })
})

describe('negative-only-instructions', () => {
  it('fires above threshold', () => {
    const raw = "- do not do A\n- don't do B\n- never do C\n- avoid D\n"
    const d = lint(raw).filter(x => x.ruleId === 'prompt/negative-only-instructions')
    expect(d.length).toBeGreaterThan(0)
  })
})

describe('instruction-stacking', () => {
  it('fires when bullet count exceeds threshold', () => {
    const bullets = Array.from({ length: 50 }, (_, i) => `- rule ${i}`).join('\n')
    const d = lint(bullets).filter(x => x.ruleId === 'prompt/instruction-stacking')
    expect(d).toHaveLength(1)
  })
})

describe('prompt-too-long', () => {
  it('fires past configured max', () => {
    const cfg = { ...defaultConfig, thresholds: { ...defaultConfig.thresholds, promptMaxChars: 100 } }
    const raw = 'x'.repeat(200)
    const d = lint(raw, 'prompt', cfg).filter(x => x.ruleId === 'prompt/too-long')
    expect(d).toHaveLength(1)
  })
})

describe('config — disabled + severity override', () => {
  it('respects disabled list', () => {
    const cfg = { ...defaultConfig, disabled: ['prompt/missing-sections'] }
    const d = lint('nothing here', 'prompt', cfg).filter(x => x.ruleId === 'prompt/missing-sections')
    expect(d).toEqual([])
  })

  it('applies severity override', () => {
    const cfg = { ...defaultConfig, severityOverrides: { 'prompt/missing-sections': 'error' as const } }
    const d = lint('nothing here', 'prompt', cfg).filter(x => x.ruleId === 'prompt/missing-sections')
    expect(d[0].severity).toBe('error')
  })
})
