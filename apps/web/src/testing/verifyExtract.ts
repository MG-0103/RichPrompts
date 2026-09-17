/**
 * Client for the sidecar `/verify-extraction` endpoint. Each candidate
 * is classified as `extract` (keep, propose to the user) or `reject`
 * (regex false positive — behavior description, references existing
 * component, etc.).
 *
 * In-memory cache keyed by sha256-ish over
 * (target, sorted-tool-names, sorted-skill-names, text). Editing one
 * candidate or adding a new registry entry only re-verifies the
 * affected ones.
 */

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

const DEFAULT_MODEL = 'gpt-4o-mini'

export type ExtractDecision = 'extract' | 'reject'

export interface ExtractionVerdict {
  decision: ExtractDecision
  reason: string
}

export interface CandidateInput {
  text: string
  target: 'schema' | 'tool' | 'skill'
  reason: string
}

export interface VerifyExtractionResult {
  verdicts: ExtractionVerdict[]
  cachedCount: number
  fetchedCount: number
  durationMs: number
  model: string
}

const clientCache = new Map<string, ExtractionVerdict>()
const CACHE_MAX = 4096

function cacheKey(
  text: string,
  target: string,
  tools: string[],
  skills: string[],
  model: string,
): string {
  const tSorted = [...new Set(tools)].sort().join('\t')
  const sSorted = [...new Set(skills)].sort().join('\t')
  const s = `${model}\0${target}\0${tSorted}\0${sSorted}\0${text}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + '.' + s.length.toString(36)
}

function cachePut(key: string, v: ExtractionVerdict) {
  if (clientCache.size >= CACHE_MAX) {
    const first = clientCache.keys().next().value
    if (first !== undefined) clientCache.delete(first)
  }
  clientCache.set(key, v)
}

export function clearExtractVerifyCache(): number {
  const n = clientCache.size
  clientCache.clear()
  return n
}

interface ServerResponse {
  verdicts: ExtractionVerdict[]
  cachedCount: number
  model: string
  durationMs: number
}

async function callServer(
  candidates: CandidateInput[],
  toolNames: string[],
  skillNames: string[],
  model: string,
  signal?: AbortSignal,
): Promise<ServerResponse> {
  const res = await fetch(`${BASE}/verify-extraction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates, toolNames, skillNames, model }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(
      `verify-extraction ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`,
    )
  }
  return (await res.json()) as ServerResponse
}

export async function verifyExtractionCandidates(
  candidates: CandidateInput[],
  toolNames: string[],
  skillNames: string[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<VerifyExtractionResult> {
  const model = opts.model ?? DEFAULT_MODEL
  if (candidates.length === 0) {
    return { verdicts: [], cachedCount: 0, fetchedCount: 0, durationMs: 0, model }
  }
  const started = performance.now()
  const keys = candidates.map(c => cacheKey(c.text, c.target, toolNames, skillNames, model))
  const verdicts: (ExtractionVerdict | undefined)[] = new Array(candidates.length)
  const missIndices: number[] = []
  let cachedCount = 0
  for (let i = 0; i < candidates.length; i++) {
    const hit = clientCache.get(keys[i])
    if (hit) {
      verdicts[i] = hit
      cachedCount++
    } else {
      missIndices.push(i)
    }
  }
  let fetchedCount = 0
  if (missIndices.length > 0) {
    const missCandidates = missIndices.map(i => candidates[i])
    const resp = await callServer(missCandidates, toolNames, skillNames, model, opts.signal)
    for (let k = 0; k < missIndices.length; k++) {
      const idx = missIndices[k]
      const v = resp.verdicts[k]
      verdicts[idx] = v
      cachePut(keys[idx], v)
    }
    fetchedCount = missIndices.length
  }
  const durationMs = performance.now() - started
  return {
    verdicts: verdicts as ExtractionVerdict[],
    cachedCount,
    fetchedCount,
    durationMs,
    model,
  }
}
