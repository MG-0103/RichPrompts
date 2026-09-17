import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clusterByPairwiseSimilarity,
  cosineSimilarity,
  detectExtractionCandidates,
  type DuplicationAnalysis,
  type DuplicationEdge,
  type ExtractionCandidate,
  type Paragraph,
} from '@richprompt/core'
import { embedTexts } from '../testing/embed'
import { verifyPairs, type VerifyVerdict } from '../testing/verify'
import { verifyExtractionCandidates } from '../testing/verifyExtract'

const SEMANTIC_THRESHOLD = 0.72   // cosine threshold for cluster edges
const MIN_CHARS = 60              // same as trigram path
const MAX_PARAGRAPHS = 250        // safety cap
const MAX_VERIFY_PAIRS = 40       // cap verifier fan-out per run

/** Labels for edges after LLM verification. Undefined until verified. */
export type EdgeLabelMap = Record<string, VerifyVerdict>

export interface ContradictionFinding {
  id: string
  fromId: string
  toId: string
  fromOffset: number
  toOffset: number
  reason: string
  similarity: number
}

export interface VerifiedExtraction {
  candidate: ExtractionCandidate
  reason: string
}

export interface SemanticState {
  active: boolean
  loading: boolean
  /** Sub-phase of the current run, when loading is true. */
  phase: 'idle' | 'embedding' | 'clustering' | 'verifying'
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
  /** Per-edge verifier verdicts, keyed by "from|to" (id-sorted). */
  edgeLabels: EdgeLabelMap
  /** Verified contradictions surfaced as their own findings. */
  contradictions: ContradictionFinding[]
  /** Extraction candidates the verifier said to keep. Empty when the
   *  extraction verifier wasn't run (either not available or no regex
   *  candidates existed). */
  verifiedExtractions: VerifiedExtraction[]
  /** True when the /verify path is available on the sidecar and we
   *  actually ran the pass this activation. */
  verified: boolean
  /** Verifier cache stats from the last pass. */
  lastVerifyCached: number
  lastVerifyFetched: number
}

/**
 * Manages the "Deep analyze" flow — fetches paragraph embeddings via
 * the sidecar and clusters by cosine similarity. Stays inert until
 * the user activates it.
 */
function edgeKey(e: DuplicationEdge): string {
  return e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
}

export function useSemanticDuplication(
  paragraphs: Paragraph[],
  sourceHash: string,
  opts: {
    verifierAvailable: boolean
    toolNames?: string[]
    skillNames?: string[]
  } = { verifierAvailable: false },
): SemanticState & {
  activate: () => Promise<void>
  deactivate: () => void
} {
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<SemanticState['phase']>('idle')
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<DuplicationAnalysis | null>(null)
  const [computedHash, setComputedHash] = useState('')
  const [computedChars, setComputedChars] = useState(0)
  const [lastDurationMs, setLastDurationMs] = useState(0)
  const [lastCachedCount, setLastCachedCount] = useState(0)
  const [lastFetchedCount, setLastFetchedCount] = useState(0)
  const [edgeLabels, setEdgeLabels] = useState<EdgeLabelMap>({})
  const [contradictions, setContradictions] = useState<ContradictionFinding[]>([])
  const [verifiedExtractions, setVerifiedExtractions] = useState<VerifiedExtraction[]>([])
  const [verified, setVerified] = useState(false)
  const [lastVerifyCached, setLastVerifyCached] = useState(0)
  const [lastVerifyFetched, setLastVerifyFetched] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const stale = active && analysis !== null && sourceHash !== computedHash

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setError(null)
    setEdgeLabels({})
    setContradictions([])
    setVerifiedExtractions([])
    setVerified(false)
    const eligible = paragraphs.filter(p => p.text.trim().length >= MIN_CHARS)
    if (eligible.length < 2) {
      setAnalysis({ clusters: [], edges: [] })
      setComputedHash(sourceHash)
      setComputedChars(paragraphs.reduce((a, p) => a + p.text.length, 0))
      setLastDurationMs(0)
      setLastCachedCount(0)
      setLastFetchedCount(0)
      setLastVerifyCached(0)
      setLastVerifyFetched(0)
      return
    }
    if (eligible.length > MAX_PARAGRAPHS) {
      setError(`Too many paragraphs to embed (${eligible.length} > ${MAX_PARAGRAPHS})`)
      return
    }

    setLoading(true)
    try {
      // ---------- Embeddings ----------
      setPhase('embedding')
      const embedRes = await embedTexts(eligible.map(p => p.text), { signal: ctrl.signal })
      if (ctrl.signal.aborted) return

      // ---------- Clustering ----------
      setPhase('clustering')
      const vecById = new Map<string, number[]>()
      for (let i = 0; i < eligible.length; i++) {
        vecById.set(eligible[i].id, embedRes.vectors[i])
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
      setLastCachedCount(embedRes.cachedCount)
      setLastFetchedCount(embedRes.fetchedCount)

      // ---------- Verification ----------
      let verifyMs = 0
      if (opts.verifierAvailable && result.edges.length > 0) {
        setPhase('verifying')
        const pById = new Map(paragraphs.map(p => [p.id, p]))
        const pairs = result.edges
          .slice()
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, MAX_VERIFY_PAIRS)
          .map(e => ({
            edge: e,
            a: pById.get(e.from)!.text,
            b: pById.get(e.to)!.text,
          }))
          .filter(p => p.a && p.b)
        try {
          const v = await verifyPairs(
            pairs.map(p => ({ a: p.a, b: p.b })),
            { signal: ctrl.signal },
          )
          if (ctrl.signal.aborted) return
          const labels: EdgeLabelMap = {}
          const contras: ContradictionFinding[] = []
          for (let i = 0; i < pairs.length; i++) {
            const verdict = v.verdicts[i]
            labels[edgeKey(pairs[i].edge)] = verdict
            if (verdict.label === 'contradictory') {
              const pa = pById.get(pairs[i].edge.from)!
              const pb = pById.get(pairs[i].edge.to)!
              contras.push({
                id: `contra-${i}`,
                fromId: pairs[i].edge.from,
                toId: pairs[i].edge.to,
                fromOffset: pa.startOffset,
                toOffset: pb.startOffset,
                reason: verdict.reason,
                similarity: pairs[i].edge.similarity,
              })
            }
          }
          setEdgeLabels(labels)
          setContradictions(contras)
          setVerified(true)
          setLastVerifyCached(v.cachedCount)
          setLastVerifyFetched(v.fetchedCount)
          verifyMs = v.durationMs
        } catch (e) {
          // Verifier failure is not fatal — keep the semantic clusters,
          // just surface a warning.
          if ((e as Error).name !== 'AbortError') {
            setError(`Verifier failed: ${(e as Error).message}. Showing unverified semantic clusters.`)
          }
        }
      }

      // ---------- Extraction verification ----------
      let extractMs = 0
      if (opts.verifierAvailable) {
        const rawCandidates = detectExtractionCandidates(paragraphs)
        if (rawCandidates.length > 0) {
          setPhase('verifying')
          try {
            const evres = await verifyExtractionCandidates(
              rawCandidates.map(c => ({
                text: paragraphs.find(p => p.id === c.paragraphIds[0])?.text ?? '',
                target: c.target,
                reason: c.reason,
              })).filter(c => c.text.length > 0),
              opts.toolNames ?? [],
              opts.skillNames ?? [],
              { signal: ctrl.signal },
            )
            if (ctrl.signal.aborted) return
            const kept: VerifiedExtraction[] = []
            for (let i = 0; i < rawCandidates.length; i++) {
              const verdict = evres.verdicts[i]
              if (verdict?.decision === 'extract') {
                kept.push({ candidate: rawCandidates[i], reason: verdict.reason })
              }
            }
            setVerifiedExtractions(kept)
            extractMs = evres.durationMs
          } catch (e) {
            // Non-fatal; keep duplication results.
            if ((e as Error).name !== 'AbortError') {
              // Only warn if not already flagged by duplication verifier.
              // The main error state is prioritized for the more central signal.
            }
          }
        }
      }

      setPhase('idle')
      setLastDurationMs(embedRes.durationMs + clusterMs + verifyMs + extractMs)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setPhase('idle')
    }
  }, [paragraphs, sourceHash, opts.verifierAvailable])

  const activate = useCallback(async () => {
    setActive(true)
    await run()
  }, [run])

  const deactivate = useCallback(() => {
    abortRef.current?.abort()
    setActive(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!active) return
    if (sourceHash === computedHash) return
    // Stale — presentation layer surfaces the banner + refresh button.
  }, [active, sourceHash, computedHash])

  return {
    active,
    loading,
    phase,
    error,
    analysis,
    stale,
    computedChars,
    lastDurationMs,
    lastCachedCount,
    lastFetchedCount,
    edgeLabels,
    contradictions,
    verifiedExtractions,
    verified,
    lastVerifyCached,
    lastVerifyFetched,
    activate,
    deactivate,
  }
}
