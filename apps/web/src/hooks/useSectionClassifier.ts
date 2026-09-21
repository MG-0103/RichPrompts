/**
 * LLM section-classifier hook. Opt-in tier-2 for `missing-sections`:
 * when the regex classifier misses paraphrase-shaped openings (e.g.
 * "As an expert…", "The goal here is…"), the user hits the "AI check"
 * button and the sidecar returns which canonical sections it actually
 * finds. Results are cached in localStorage by (docType, content hash)
 * so switching tabs / reloading doesn't re-spend a call.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CanonicalSection } from '@richprompt/core'
import { classifySections } from '../testing/classify'

const STORAGE_KEY = 'richprompt.sectionClassifier.v1'
const MAX_ENTRIES = 20

interface CacheEntry {
  hash: string
  found: CanonicalSection[]
  reasoning: string
  timestamp: number
  truncatedFrom?: number
}

function readCache(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CacheEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCache(entries: CacheEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* quota — silently drop */
  }
}

function lookup(hash: string): CacheEntry | null {
  return readCache().find(e => e.hash === hash) ?? null
}

function upsert(entry: CacheEntry) {
  const filtered = readCache().filter(e => e.hash !== entry.hash)
  filtered.push(entry)
  writeCache(filtered)
}

export interface SectionClassifierState {
  /** Non-null when we have a result for the CURRENT hash — either from
   *  a fresh run or the persistent cache. */
  found: CanonicalSection[] | null
  reasoning: string
  /** True when a fresh /classify-sections call is in flight. */
  loading: boolean
  error: string | null
  /** True when the found set was loaded from cache, not just now. */
  cached: boolean
  /** > 0 when the last result was computed on a truncated prefix of the
   *  source. Carries the original char count so the UI can say
   *  "classified first 32k of {truncatedFrom} chars". */
  truncatedFrom: number
  run: () => Promise<void>
  clear: () => void
}

export function useSectionClassifier(
  source: string,
  contentHash: string,
): SectionClassifierState {
  const [found, setFound] = useState<CanonicalSection[] | null>(null)
  const [reasoning, setReasoning] = useState('')
  const [cached, setCached] = useState(false)
  const [truncatedFrom, setTruncatedFrom] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate from cache on hash change.
  useEffect(() => {
    const hit = lookup(contentHash)
    if (hit) {
      setFound(hit.found)
      setReasoning(hit.reasoning)
      setTruncatedFrom(hit.truncatedFrom ?? 0)
      setCached(true)
      setError(null)
    } else {
      setFound(null)
      setReasoning('')
      setTruncatedFrom(0)
      setCached(false)
    }
  }, [contentHash])

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await classifySections(source)
      setFound(res.found)
      setReasoning(res.reasoning)
      setTruncatedFrom(res.truncatedFrom)
      setCached(false)
      upsert({
        hash: contentHash,
        found: res.found,
        reasoning: res.reasoning,
        truncatedFrom: res.truncatedFrom,
        timestamp: Date.now(),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [source, contentHash])

  const clear = useCallback(() => {
    setFound(null)
    setReasoning('')
    setTruncatedFrom(0)
    setCached(false)
    setError(null)
    const kept = readCache().filter(e => e.hash !== contentHash)
    writeCache(kept)
  }, [contentHash])

  return { found, reasoning, loading, error, cached, truncatedFrom, run, clear }
}
