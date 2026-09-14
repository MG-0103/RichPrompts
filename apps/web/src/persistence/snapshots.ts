import type { DocType } from '@richprompt/core'

export interface Snapshot {
  docId: DocType
  contentHash: number
  timestamp: number
  score: number
  errorCount: number
  warnCount: number
  infoCount: number
  charCount: number
}

const KEY = 'richprompt.snapshots.v1'
const MAX_PER_DOC = 60

type Store = Record<string, Snapshot[]>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Store
  } catch {
    return {}
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch { /* quota full — silently drop */ }
}

export function loadSnapshots(docId: DocType): Snapshot[] {
  return read()[docId] ?? []
}

export function pushSnapshot(snap: Snapshot): Snapshot[] {
  const store = read()
  const history = store[snap.docId] ?? []
  const last = history[history.length - 1]
  if (last && last.contentHash === snap.contentHash) return history
  const next = [...history, snap].slice(-MAX_PER_DOC)
  store[snap.docId] = next
  write(store)
  return next
}

export function clearSnapshots(docId?: DocType) {
  const store = read()
  if (!docId) {
    localStorage.removeItem(KEY)
    return
  }
  delete store[docId]
  write(store)
}
