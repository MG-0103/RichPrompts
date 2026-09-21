/**
 * Client for the sidecar `/classify-sections` endpoint. Returns which of
 * the four canonical sections (role/task/output/constraints) the LLM
 * judges to be present in the doc, regardless of whether they appear
 * under labelled headings. Used as a tier-2 fallback for the regex
 * classifier — corrects the paraphrase-shaped misses ("As an expert…",
 * "The goal here is…") the strict `inferBodyCanonicals` patterns skip.
 */

import type { CanonicalSection } from '@richprompt/core'

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

const DEFAULT_MODEL = 'gpt-4o-mini'

export interface ClassifyResult {
  found: CanonicalSection[]
  reasoning: string
  cached: boolean
  durationMs: number
  model: string
}

interface ServerResponse {
  found: CanonicalSection[]
  reasoning: string
  cached: boolean
  model: string
  durationMs: number
}

export async function classifySections(
  source: string,
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<ClassifyResult> {
  const model = opts.model ?? DEFAULT_MODEL
  const res = await fetch(`${BASE}/classify-sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, model }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(
      `classify ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`,
    )
  }
  const data = (await res.json()) as ServerResponse
  return {
    found: data.found,
    reasoning: data.reasoning,
    cached: data.cached,
    durationMs: data.durationMs,
    model: data.model,
  }
}
