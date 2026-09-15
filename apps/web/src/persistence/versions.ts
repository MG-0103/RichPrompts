/**
 * Two-tier version storage.
 *
 * - Auto (kind='auto'): 2s idle debounce, hash-dedup, cap MAX_AUTO
 *   per doc, LRU-evicted. Safety-net only.
 * - Commit (kind='commit'): explicit user action with a label,
 *   kept forever until the user deletes.
 *
 * All versions live under one localStorage key, keyed by docId.
 */

import type { DocType, Version } from '@richprompt/core'

const KEY = 'richprompt.versions.v1'
const MAX_AUTO = 20

type Store = Record<string, Version[]>

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
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch { /* quota */ }
}

export function loadVersions(docId: DocType): Version[] {
  return read()[docId] ?? []
}

export function loadAllVersions(): Store {
  return read()
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Append an auto snapshot. Hash-dedup: if the last version for
 *  this doc has the same hash (regardless of kind), we skip. */
export function pushAuto(docId: DocType, content: string): Version[] {
  const store = read()
  const list = store[docId] ?? []
  const contentHash = hashString(content)
  const last = list[list.length - 1]
  if (last && last.contentHash === contentHash) return list

  const next: Version = {
    docId,
    id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'auto',
    timestamp: Date.now(),
    contentHash,
    content,
  }
  // Cap auto: drop oldest autos when over MAX_AUTO, keep every commit.
  const merged = [...list, next]
  const autos = merged.filter(v => v.kind === 'auto')
  if (autos.length > MAX_AUTO) {
    const excess = autos.length - MAX_AUTO
    const toDrop = new Set(autos.slice(0, excess).map(v => v.id))
    store[docId] = merged.filter(v => !toDrop.has(v.id))
  } else {
    store[docId] = merged
  }
  write(store)
  return store[docId]
}

export function commit(docId: DocType, content: string, label: string): Version[] {
  const store = read()
  const list = store[docId] ?? []
  const next: Version = {
    docId,
    id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'commit',
    label: label.trim() || `commit ${new Date().toLocaleString()}`,
    timestamp: Date.now(),
    contentHash: hashString(content),
    content,
  }
  store[docId] = [...list, next]
  write(store)
  return store[docId]
}

export function renameVersion(docId: DocType, id: string, label: string): Version[] {
  const store = read()
  const list = store[docId] ?? []
  store[docId] = list.map(v => v.id === id ? { ...v, label } : v)
  write(store)
  return store[docId]
}

export function deleteVersion(docId: DocType, id: string): Version[] {
  const store = read()
  const list = store[docId] ?? []
  store[docId] = list.filter(v => v.id !== id)
  write(store)
  return store[docId]
}
