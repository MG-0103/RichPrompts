import { lint, defaultConfig } from '@richprompt/core'
import type { Diagnostic, DocType } from '@richprompt/core'

export interface LintRequest {
  id: number
  raw: string
  docType: DocType
}

export interface LintResponse {
  id: number
  diagnostics: Diagnostic[]
}

self.onmessage = (e: MessageEvent<LintRequest>) => {
  const { id, raw, docType } = e.data
  const diagnostics = lint(raw, docType, defaultConfig)
  const res: LintResponse = { id, diagnostics }
  ;(self as unknown as Worker).postMessage(res)
}
