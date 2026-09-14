import { useEffect, useRef, useState } from 'react'
import type { Diagnostic, DocType, RuleConfig } from '@richprompt/core'
import LintWorker from '../worker/lint.worker?worker'
import type { LintRequest, LintResponse } from '../worker/lint.worker'

const DEBOUNCE_MS = 0

export function useLinter(raw: string, docType: DocType = 'prompt', config?: RuleConfig) {
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef(0)
  const latestSeenRef = useRef(0)

  useEffect(() => {
    const w = new LintWorker()
    workerRef.current = w
    w.onmessage = (e: MessageEvent<LintResponse>) => {
      if (e.data.id < latestSeenRef.current) return
      latestSeenRef.current = e.data.id
      setDiagnostics(e.data.diagnostics)
    }
    return () => {
      w.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (!workerRef.current) return
      const id = ++seqRef.current
      const req: LintRequest = { id, raw, docType, config }
      workerRef.current.postMessage(req)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [raw, docType, config])

  return diagnostics
}
