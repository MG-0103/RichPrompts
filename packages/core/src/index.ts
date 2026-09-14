export * from './types'
export { defaultConfig } from './config'
export { parseDocument } from './parser'
export { parseToolDocument } from './toolParser'
export type { ParsedTool, ToolParam } from './toolParser'
export { runRules } from './engine'
export {
  promptRules,
  toolPackRules,
  skillPackRules,
  structuralRules,
  patternRules,
  toolRules,
  skillRules,
  rulesFor,
} from './rules'
export { badPrompt } from './fixtures/badPrompt'
export { goodPrompt } from './fixtures/goodPrompt'
export { badTool } from './fixtures/badTool'
export { badSkill } from './fixtures/badSkill'

import { parseDocument } from './parser'
import { parseToolDocument } from './toolParser'
import { runRules } from './engine'
import { rulesFor } from './rules'
import { defaultConfig } from './config'
import type { DocType, Diagnostic, RuleConfig } from './types'

export function lint(
  raw: string,
  docType: DocType = 'prompt',
  config: RuleConfig = defaultConfig,
): Diagnostic[] {
  const doc = docType === 'tool' ? parseToolDocument(raw) : parseDocument(raw, docType)
  return runRules(doc, rulesFor(docType), config)
}
