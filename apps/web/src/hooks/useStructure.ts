import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocType, StructureReport } from '@richprompt/core'
import StructureWorker from '../worker/structure.worker?worker'
import type { StructureRequest, StructureResponse } from '../worker/structure.worker'

const AUTO_DEBOUNCE_MS = 3000
/** Above this char count, auto-recompute stops firing — user re-runs
 *  manually via the "Re-analyze" button. */
const AUTO_THRESHOLD_CHARS = 30_000

function hashChars(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export interface UseStructureResult {
  report: StructureReport | null
  loading: boolean
  stale: boolean
  manualMode: boolean
  lastDurationMs: number
  computedChars: number
  reanalyze: () => void
}

export function useStructure(
  source: string,
  docType: DocType,
  model: string,
): UseStructureResult {
  const [report, setReport] = useState<StructureReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastDurationMs, setLastDurationMs] = useState(0)
  const [computedHash, setComputedHash] = useState('')
  const [computedChars, setComputedChars] = useState(0)

  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef(0)
  const shouldRun = docType !== 'tool'
  const currentHash = shouldRun ? hashChars(source) : ''
  const manualMode = shouldRun && source.length > AUTO_THRESHOLD_CHARS
  const stale = shouldRun && currentHash !== '' && currentHash !== computedHash && !loading

  // Create worker once; handler closes over the setters via refs so it
  // doesn't need to be re-wired every render.
  useEffect(() => {
    if (!shouldRun) {
      setReport(null); setComputedHash(''); setComputedChars(0)
      return
    }
    const w = new StructureWorker()
    workerRef.current = w
    w.onmessage = (e: MessageEvent<StructureResponse>) => {
      const { id, hash, report: r, durationMs } = e.data
      // Ignore stale responses if a newer one has landed.
      if (id < seqRef.current - 1) return
      setReport(r)
      setLastDurationMs(durationMs)
      setComputedHash(hash)
      setComputedChars(r.chars)
      setLoading(false)
    }
    return () => {
      w.terminate()
      workerRef.current = null
    }
  }, [shouldRun])

  const post = useCallback((raw: string) => {
    const w = workerRef.current
    if (!w) return
    const id = ++seqRef.current
    const hash = hashChars(raw)
    setLoading(true)
    const req: StructureRequest = { id, raw, docType, model, hash }
    w.postMessage(req)
  }, [docType, model])

  // Auto-run under threshold: debounced.
  useEffect(() => {
    if (!shouldRun || manualMode) return
    if (currentHash === computedHash) return
    const t = window.setTimeout(() => post(source), AUTO_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [source, currentHash, computedHash, manualMode, shouldRun, post])

  // First-run kick when we have a worker and no report yet.
  useEffect(() => {
    if (!shouldRun || report !== null) return
    if (manualMode) return
    if (!workerRef.current) return
    post(source)
  }, [shouldRun, report, manualMode, source, post])

  const reanalyze = useCallback(() => {
    if (shouldRun) post(source)
  }, [shouldRun, source, post])

  return {
    report,
    loading,
    stale,
    manualMode,
    lastDurationMs,
    computedChars,
    reanalyze,
  }
}
