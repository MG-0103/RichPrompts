import type { TestRunRequest, TestRunResponse } from '@richprompt/core'

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

export async function runTests(req: TestRunRequest, signal?: AbortSignal): Promise<TestRunResponse> {
  const res = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`testrunner ${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as TestRunResponse
}

export async function checkHealth(signal?: AbortSignal): Promise<{ ok: boolean; version?: string; mode?: string }> {
  try {
    const res = await fetch(`${BASE}/health`, { signal })
    if (!res.ok) return { ok: false }
    return await res.json()
  } catch {
    return { ok: false }
  }
}
