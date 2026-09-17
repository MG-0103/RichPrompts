/**
 * Client for the sidecar `/embed` endpoint. Batches, retries the
 * request as a whole on transient failures, and layers an in-memory
 * cache on top so the same text isn't re-fetched inside a session.
 * The sidecar has its own cache; ours is here to also skip the
 * round-trip when nothing changed between doc edits.
 */

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

const DEFAULT_MODEL = 'text-embedding-3-small'

export interface EmbedResult {
  vectors: number[][]
  cachedCount: number
  fetchedCount: number
  durationMs: number
  model: string
}

type CacheKey = string  // "<model>\0<text>"

const clientCache = new Map<CacheKey, number[]>()
const CACHE_MAX = 4096

function cacheKey(model: string, text: string): CacheKey {
  return `${model}\0${text}`
}

function cachePut(key: CacheKey, vec: number[]) {
  if (clientCache.size >= CACHE_MAX) {
    // Evict an arbitrary entry — bounded, not LRU.
    const first = clientCache.keys().next().value
    if (first !== undefined) clientCache.delete(first)
  }
  clientCache.set(key, vec)
}

export function clearEmbedCache(): number {
  const n = clientCache.size
  clientCache.clear()
  return n
}

export function embedCacheSize(): number {
  return clientCache.size
}

interface ServerResponse {
  vectors: number[][]
  cachedCount: number
  model: string
  durationMs: number
}

async function callServer(
  texts: string[],
  model: string,
  signal?: AbortSignal,
): Promise<ServerResponse> {
  const res = await fetch(`${BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, model }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(`embed ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`)
  }
  return (await res.json()) as ServerResponse
}

/**
 * Return one vector per input text, in input order. Cache hits are
 * served without a network round-trip; misses are batched into one
 * request to the sidecar.
 */
export async function embedTexts(
  texts: string[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  const model = opts.model ?? DEFAULT_MODEL
  if (texts.length === 0) {
    return { vectors: [], cachedCount: 0, fetchedCount: 0, durationMs: 0, model }
  }
  const started = performance.now()
  const keys = texts.map(t => cacheKey(model, t))
  const vectors: (number[] | undefined)[] = new Array(texts.length)
  const missIndices: number[] = []
  let cachedCount = 0
  for (let i = 0; i < texts.length; i++) {
    const hit = clientCache.get(keys[i])
    if (hit) {
      vectors[i] = hit
      cachedCount++
    } else {
      missIndices.push(i)
    }
  }
  let fetchedCount = 0
  if (missIndices.length > 0) {
    const missTexts = missIndices.map(i => texts[i])
    const resp = await callServer(missTexts, model, opts.signal)
    for (let k = 0; k < missIndices.length; k++) {
      const idx = missIndices[k]
      const vec = resp.vectors[k]
      vectors[idx] = vec
      cachePut(keys[idx], vec)
    }
    fetchedCount = missIndices.length
  }
  const durationMs = performance.now() - started
  const complete = vectors as number[][]
  return { vectors: complete, cachedCount, fetchedCount, durationMs, model }
}
