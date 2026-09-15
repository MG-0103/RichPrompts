import type { TestCase } from '@richprompt/core'

const KEY = 'richprompt.tests.v1'

export function loadTests(): TestCase[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return SEED_TESTS
    const parsed = JSON.parse(raw) as TestCase[]
    return Array.isArray(parsed) ? parsed : SEED_TESTS
  } catch {
    return SEED_TESTS
  }
}

export function saveTests(tests: TestCase[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tests))
  } catch { /* quota — silently drop */ }
}

export function resetTests(): TestCase[] {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  return SEED_TESTS
}

const SEED_TESTS: TestCase[] = [
  {
    id: 'web-search',
    query: 'search the web for recent papers on retrieval-augmented generation',
    expect: { kind: 'tool', name: 'search_web' },
    notes: 'Should pick search_web over web_query — descriptions overlap on purpose (Tier-2 test).',
  },
  {
    id: 'file-read',
    query: 'show me the contents of /etc/hosts',
    expect: { kind: 'tool', name: 'read_file' },
  },
  {
    id: 'weather-skill',
    query: "what's the weather like in San Francisco right now",
    expect: { kind: 'skill', name: 'weather_lookup' },
    notes: 'Two skills overlap here (weather_lookup vs. weather_forecast) — both are plausible.',
  },
  {
    id: 'no-tool',
    query: 'thanks, that helps',
    expect: { kind: 'none' },
    notes: 'Router should not call any tool for a conversational reply.',
  },
]
