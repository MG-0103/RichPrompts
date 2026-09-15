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
    id: 'weather-basic',
    query: "what's the weather like in San Francisco right now",
    expect: { kind: 'tool', name: 'get_weather' },
    notes: 'Basic routing sanity check.',
  },
  {
    id: 'search-docs',
    query: 'find the section in our onboarding guide about vacation policy',
    expect: { kind: 'tool', name: 'search_docs' },
  },
  {
    id: 'no-tool',
    query: 'thanks, that helps',
    expect: { kind: 'none' },
    notes: 'Router should not call any tool for a conversational reply.',
  },
]
