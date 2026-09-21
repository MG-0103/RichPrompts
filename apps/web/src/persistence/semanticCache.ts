import type { DuplicationAnalysis } from '@richprompt/core'
import type {
  ContradictionFinding,
  EdgeLabelMap,
  VerifiedExtraction,
} from '../hooks/useSemanticDuplication'

const STORAGE_KEY = 'richprompt.semantic.cache'
const MAX_ENTRIES = 10

export interface SemanticCacheEntry {
  hash: string
  timestamp: number
  analysis: DuplicationAnalysis
  edgeLabels: EdgeLabelMap
  contradictions: ContradictionFinding[]
  verifiedExtractions: VerifiedExtraction[]
  verified: boolean
  computedChars: number
  lastDurationMs: number
  lastCachedCount: number
  lastFetchedCount: number
  lastVerifyCached: number
  lastVerifyFetched: number
}

function load(): SemanticCacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SemanticCacheEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function save(entries: SemanticCacheEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Likely quota; drop the oldest half and retry once.
    try {
      const half = entries.slice(-Math.floor(MAX_ENTRIES / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(half))
    } catch { /* give up silently */ }
  }
}

export function readSemanticCache(hash: string): SemanticCacheEntry | null {
  const entries = load()
  return entries.find(e => e.hash === hash) ?? null
}

export function writeSemanticCache(entry: SemanticCacheEntry): void {
  const entries = load().filter(e => e.hash !== entry.hash)
  entries.push(entry)
  // Keep newest MAX_ENTRIES, sorted by timestamp desc.
  entries.sort((a, b) => b.timestamp - a.timestamp)
  save(entries.slice(0, MAX_ENTRIES))
}

export function listSemanticCache(): SemanticCacheEntry[] {
  return load().sort((a, b) => b.timestamp - a.timestamp)
}

export function clearSemanticCache(hash?: string): void {
  if (!hash) { save([]); return }
  save(load().filter(e => e.hash !== hash))
}
