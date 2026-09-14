export * from './types'
export { defaultConfig } from './config'
export { parseDocument } from './parser'
export { runRules } from './engine'
export { promptRules, structuralRules, patternRules } from './rules'
export { badPrompt } from './fixtures/badPrompt'
export { goodPrompt } from './fixtures/goodPrompt'

import { parseDocument } from './parser'
import { runRules } from './engine'
import { promptRules } from './rules'
import { defaultConfig } from './config'
import type { DocType, Diagnostic, RuleConfig } from './types'

export function lint(
  raw: string,
  docType: DocType = 'prompt',
  config: RuleConfig = defaultConfig,
): Diagnostic[] {
  const doc = parseDocument(raw, docType)
  return runRules(doc, promptRules, config)
}
