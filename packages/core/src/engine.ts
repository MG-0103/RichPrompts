import type { Diagnostic, ParsedDoc, Rule, RuleConfig } from './types'

export function runRules(doc: ParsedDoc, rules: Rule[], config: RuleConfig): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const rule of rules) {
    if (config.disabled.includes(rule.id)) continue
    if (!rule.appliesTo.includes(doc.docType)) continue
    const diagnostics = rule.check(doc, { config })
    const override = config.severityOverrides[rule.id]
    for (const d of diagnostics) {
      out.push(override ? { ...d, severity: override } : d)
    }
  }
  return out
}
