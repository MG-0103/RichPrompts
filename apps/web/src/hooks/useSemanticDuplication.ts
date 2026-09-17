import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clusterByPairwiseSimilarity,
  cosineSimilarity,
  type DuplicationAnalysis,
  type Paragraph,
} from '@richprompt/core'
import { embedTexts } from '../testing/embed'

const SEMANTIC_THRESHOLD = 0.72   // cosine threshold for cluster edges
const MIN_CHARS = 60              // same as trigram path
const MAX_PARAGRAPHS = 250        // safety cap

export interface SemanticState {
  active: boolean
  loading: boolean
  error: string | null
  /** Analysis produced by the last successful deep pass — or null. */
  analysis: DuplicationAnalysis | null
  /** True when the doc hash has moved since the last successful pass. */
  stale: boolean
  /** Chars in the source at the moment of the last successful pass. */
  computedChars: number
  /** How long the last pass took (ms). */
  lastDurationMs: number
  /** Cache hits and misses recorded in the last pass. */
  lastCachedCount: number
  lastFetchedCount: number
}

/**
 * Manages the "Deep analyze" flow — fetches paragraph embeddings via
 * the sidecar and clusters by cosine similarity. Stays inert until
 * the user activates it.
 */
export function useSemanticDuplication(
  paragraphs: Paragraph[],
  sourceHash: string,
): SemanticState & {
  activate: () => Promise<void>
  deactivate: () => void
} {
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<DuplicationAnalysis | null>(null)
  const [computedHash, setComputedHash] = useState('')
  const [computedChars, setComputedChars] = useState(0)
  const [lastDurationMs, setLastDurationMs] = useState(0)
  const [lastCachedCount, setLastCachedCount] = useState(0)
  const [lastFetchedCount, setLastFetchedCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const stale = active && analysis !== null && sourceHash !== computedHash

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setError(null)
    const eligible = paragraphs.filter(p => p.text.trim().length >= MIN_CHARS)
    if (eligible.length < 2) {
      setAnalysis({ clusters: [], edges: [] })
      setComputedHash(sourceHash)
      setComputedChars(paragraphs.reduce((a, p) => a + p.text.length, 0))
      setLastDurationMs(0)
      setLastCachedCount(0)
      setLastFetchedCount(0)
      return
    }
    if (eligible.length > MAX_PARAGRAPHS) {
      setError(`Too many paragraphs to embed (${eligible.length} > ${MAX_PARAGRAPHS})`)
      return
    }

    setLoading(true)
    try {
      const res = await embedTexts(eligible.map(p => p.text), { signal: ctrl.signal })
      const vecById = new Map<string, number[]>()
      for (let i = 0; i < eligible.length; i++) {
        vecById.set(eligible[i].id, res.vectors[i])
      }
      const simFn = (a: Paragraph, b: Paragraph): number => {
        const va = vecById.get(a.id)
        const vb = vecById.get(b.id)
        if (!va || !vb) return 0
        return cosineSimilarity(va, vb)
      }
      const t0 = performance.now()
      const result = clusterByPairwiseSimilarity(paragraphs, simFn, {
        threshold: SEMANTIC_THRESHOLD,
        minChars: MIN_CHARS,
        maxParagraphs: MAX_PARAGRAPHS,
      })
      const clusterMs = performance.now() - t0
      setAnalysis(result)
      setComputedHash(sourceHash)
      setComputedChars(paragraphs.reduce((a, p) => a + p.text.length, 0))
      setLastDurationMs(res.durationMs + clusterMs)
      setLastCachedCount(res.cachedCount)
      setLastFetchedCount(res.fetchedCount)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [paragraphs, sourceHash])

  const activate = useCallback(async () => {
    setActive(true)
    await run()
  }, [run])

  const deactivate = useCallback(() => {
    abortRef.current?.abort()
    setActive(false)
    setError(null)
  }, [])

  // Auto-invalidate when the doc changes while active. Don't auto-rerun
  // (that'd burn API calls on every keystroke); let the user click to
  // refresh from the stale banner.
  useEffect(() => {
    if (!active) return
    if (sourceHash === computedHash) return
    // Analysis is now stale — presentation layer will surface the
    // banner + refresh button.
  }, [active, sourceHash, computedHash])

  return {
    active,
    loading,
    error,
    analysis,
    stale,
    computedChars,
    lastDurationMs,
    lastCachedCount,
    lastFetchedCount,
    activate,
    deactivate,
  }
}
