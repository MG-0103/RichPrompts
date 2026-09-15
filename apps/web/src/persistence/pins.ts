/**
 * Registry pins. A pin captures the routing-relevant state of the
 * workspace at one moment — the prompt and the full tool/skill
 * registry — so it can be reused as a baseline for A/B routing
 * comparisons. Distinct from per-document snapshots (phase 9), which
 * are per-doc content history for restore/diff of the source itself.
 */

export interface RegistryPin {
  id: string
  label: string
  timestamp: number
  prompt: string
  tools: { id: string; raw: string }[]
  skills: { id: string; raw: string }[]
}

const KEY = 'richprompt.registry.pins.v1'
const MAX_PINS = 20

export function loadPins(): RegistryPin[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RegistryPin[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePins(pins: RegistryPin[]) {
  try { localStorage.setItem(KEY, JSON.stringify(pins.slice(-MAX_PINS))) } catch { /* ignore */ }
}

export function addPin(pin: Omit<RegistryPin, 'id' | 'timestamp'>): RegistryPin[] {
  const full: RegistryPin = {
    ...pin,
    id: `pin-${Date.now().toString(36)}`,
    timestamp: Date.now(),
  }
  const next = [...loadPins(), full]
  savePins(next)
  return next
}

export function removePin(id: string): RegistryPin[] {
  const next = loadPins().filter(p => p.id !== id)
  savePins(next)
  return next
}

export function renamePin(id: string, label: string): RegistryPin[] {
  const next = loadPins().map(p => p.id === id ? { ...p, label } : p)
  savePins(next)
  return next
}
