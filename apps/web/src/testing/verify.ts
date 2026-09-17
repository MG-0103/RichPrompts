/**
 * Client for the sidecar `/verify` endpoint. Classifies paragraph
 * pairs as duplicate / contradictory / related / unrelated. Batched
 * with an in-memory cache keyed by an order-independent sha256-ish
 * hash so swapping (a, b) → (b, a) hits the same key.
 */

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

const DEFAULT_MODEL = 'gpt-4o-mini'

export type VerifyLabel = 'duplicate' | 'contradictory' | 'related' | 'unrelated'

export interface VerifyVerdict {
  label: VerifyLabel
  reason: string
}

export interface VerifyPairInput {
  a: string
  b: string
}

export interface VerifyResult {
  verdicts: VerifyVerdict[]
  cachedCount: number
  fetchedCount: number
  durationMs: number
  model: string
}

const clientCache = new Map<string, VerifyVerdict>()
const CACHE_MAX = 4096

// Small FNV-ish hash; order-independent (canonicalize before hashing).
function orderKey(a: string, b: string, model: string): string {
  const [left, right] = a <= b ? [a, b] : [b, a]
  const s = `${model}\0${left}\0${right}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + '.' + s.length.toString(36)
}

function cachePut(key: string, v: VerifyVerdict) {
  if (clientCache.size >= CACHE_MAX) {
    const first = clientCache.keys().next().value
    if (first !== undefined) clientCache.delete(first)
  }
  clientCache.set(key, v)
}

export function clearVerifyCache(): number {
  const n = clientCache.size
  clientCache.clear()
  return n
}

interface ServerResponse {
  verdicts: VerifyVerdict[]
  cachedCount: number
  model: string
  durationMs: number
}

async function callServer(
  pairs: VerifyPairInput[],
  model: string,
  signal?: AbortSignal,
): Promise<ServerResponse> {
  const res = await fetch(`${BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs, model }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(`verify ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`)
  }
  return (await res.json()) as ServerResponse
}

export async function verifyPairs(
  pairs: VerifyPairInput[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<VerifyResult> {
  const model = opts.model ?? DEFAULT_MODEL
  if (pairs.length === 0) {
    return { verdicts: [], cachedCount: 0, fetchedCount: 0, durationMs: 0, model }
  }
  const started = performance.now()
  const keys = pairs.map(p => orderKey(p.a, p.b, model))
  const verdicts: (VerifyVerdict | undefined)[] = new Array(pairs.length)
  const missIndices: number[] = []
  let cachedCount = 0
  for (let i = 0; i < pairs.length; i++) {
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
    const missPairs = missIndices.map(i => pairs[i])
    const resp = await callServer(missPairs, model, opts.signal)
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
    verdicts: verdicts as VerifyVerdict[],
    cachedCount,
    fetchedCount,
    durationMs,
    model,
  }
}
