/**
 * Per-doc dismissed finding IDs, keyed by content hash. Once the doc
 * content changes, the hash changes, and dismissals stop applying —
 * which is what we want: dismissals refer to a specific state, not
 * the doc identity.
 */

const KEY = 'richprompt.dismissals.v1'
const MAX_HASHES = 40

type Store = Record<string, string[]>

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
    // Bound the store — trim oldest hashes if we cross the cap.
    const keys = Object.keys(store)
    if (keys.length > MAX_HASHES) {
      const drop = keys.slice(0, keys.length - MAX_HASHES)
      for (const k of drop) delete store[k]
    }
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch { /* quota */ }
}

export function loadDismissals(hash: string): Set<string> {
  return new Set(read()[hash] ?? [])
}

export function toggleDismissal(hash: string, id: string): Set<string> {
  const store = read()
  const list = new Set(store[hash] ?? [])
  if (list.has(id)) list.delete(id)
  else list.add(id)
  store[hash] = Array.from(list)
  write(store)
  return list
}

export function clearDismissals(hash: string) {
  const store = read()
  delete store[hash]
  write(store)
}
