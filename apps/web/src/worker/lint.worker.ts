import { lint, defaultConfig } from '@richprompt/core'
import type { Diagnostic, DocType, RuleConfig } from '@richprompt/core'

export interface LintRequest {
  id: number
  raw: string
  docType: DocType
  config?: RuleConfig
}

export interface LintResponse {
  id: number
  diagnostics: Diagnostic[]
}

self.onmessage = (e: MessageEvent<LintRequest>) => {
  const { id, raw, docType, config } = e.data
  const diagnostics = lint(raw, docType, config ?? defaultConfig)
  const res: LintResponse = { id, diagnostics }
  ;(self as unknown as Worker).postMessage(res)
}
