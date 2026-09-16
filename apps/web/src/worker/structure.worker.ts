import { analyzeStructure } from '@richprompt/core'
import type { DocType, StructureReport } from '@richprompt/core'

export interface StructureRequest {
  id: number
  raw: string
  docType: DocType
  model?: string
  /** Content hash the caller wants echoed back so it can resolve
   *  staleness without touching the raw source. */
  hash: string
}

export interface StructureResponse {
  id: number
  hash: string
  report: StructureReport
  durationMs: number
}

self.onmessage = (e: MessageEvent<StructureRequest>) => {
  const { id, raw, docType, model, hash } = e.data
  const t0 = performance.now()
  const report = analyzeStructure(raw, docType, { model })
  const durationMs = performance.now() - t0
  const res: StructureResponse = { id, hash, report, durationMs }
  ;(self as unknown as Worker).postMessage(res)
}
