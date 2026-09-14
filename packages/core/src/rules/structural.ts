import type { Diagnostic, ParsedDoc, Rule } from '../types'

const REQUIRED_SECTIONS = ['role', 'task', 'output', 'constraints']

const missingSections: Rule = {
  id: 'prompt/missing-sections',
  pack: 'prompt',
  defaultSeverity: 'warn',
  appliesTo: ['prompt'],
  docsRef: 'docs/06-anti-patterns.md § 1 (Vague prompts)',
  check(doc) {
    const names = new Set(
      doc.sections
        .filter(s => s.kind === 'heading' || s.kind === 'xml')
        .map(s => s.name.toLowerCase())
    )
    const missing = REQUIRED_SECTIONS.filter(
      req => ![...names].some(n => n.includes(req))
    )
    if (missing.length === 0) return []
    return [
      {
        ruleId: 'prompt/missing-sections',
        severity: 'warn',
        message: `Missing recommended sections: ${missing.join(', ')}. Add headings or <${missing[0]}> tags.`,
        range: { startOffset: 0, endOffset: Math.min(doc.raw.length, 1) },
        docsRef: 'docs/06-anti-patterns.md § 1 (Vague prompts)',
      },
    ]
  },
}

const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g

const undefinedVariable: Rule = {
  id: 'prompt/undefined-variable',
  pack: 'prompt',
  defaultSeverity: 'error',
  appliesTo: ['prompt', 'skill'],
  check(doc) {
    const fm = doc.sections.find(s => s.kind === 'frontmatter')
    if (!fm) return []
    const declared = collectFrontmatterVars(doc)
    const out: Diagnostic[] = []
    for (const m of doc.raw.matchAll(VAR_RE)) {
      if (m.index === undefined) continue
      const name = m[1]
      if (declared.has(name)) continue
      out.push({
        ruleId: 'prompt/undefined-variable',
        severity: 'error',
        message: `Template variable {{${name}}} is not declared in frontmatter.`,
        range: { startOffset: m.index, endOffset: m.index + m[0].length },
        fix: `Declare ${name} under 'variables:' in frontmatter.`,
      })
    }
    return out
  },
}

function collectFrontmatterVars(doc: ParsedDoc): Set<string> {
  const fm = doc.sections.find(s => s.kind === 'frontmatter')
  if (!fm) return new Set()
  const out = new Set<string>()
  const varsBlock = fm.text.match(/variables:\s*\n((?:\s*-\s*.+\n?)+)/)
  if (varsBlock) {
    for (const line of varsBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s*(\S+)/)
      if (m) out.add(m[1])
    }
  }
  return out
}

const XML_DELIMITER_RE = /<(input|data|user_input|content|context|query|document|documents)\b[^>]*>/i
const MD_HEADING_DELIMITER_RE = /^\s{0,3}#{1,6}\s+(input|data|user[_ ]input|content|context|query|document|documents)\b/im
const FENCE_DELIMITER_RE = /^\s{0,3}(?:```|~~~)/m

const missingDelimiter: Rule = {
  id: 'prompt/missing-data-delimiter',
  pack: 'prompt',
  defaultSeverity: 'info',
  appliesTo: ['prompt'],
  docsRef: 'docs/01-fundamentals.md § 5 (Structure prompts with delimiters)',
  check(doc) {
    const hasInterpolation = /\{\{[^}]+\}\}/.test(doc.raw)
    if (!hasInterpolation) return []
    if (
      XML_DELIMITER_RE.test(doc.raw) ||
      MD_HEADING_DELIMITER_RE.test(doc.raw) ||
      FENCE_DELIMITER_RE.test(doc.raw)
    ) return []
    return [
      {
        ruleId: 'prompt/missing-data-delimiter',
        severity: 'info',
        message:
          'Prompt interpolates variables but has no delimiter separating instructions from user data (XML tag, markdown heading, or fenced block).',
        range: { startOffset: 0, endOffset: Math.min(doc.raw.length, 1) },
        fix: 'Wrap injected data in <input>{{x}}</input>, under a "# Input" heading, or inside a ``` fenced block.',
        docsRef: 'docs/01-fundamentals.md § 5 (Structure prompts with delimiters)',
      },
    ]
  },
}

export const structuralRules: Rule[] = [missingSections, undefinedVariable, missingDelimiter]
