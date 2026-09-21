/**
 * Client for the sidecar `/merge-cluster` endpoint. Sends the N member
 * paragraphs of a duplication cluster, gets back one merged paragraph
 * plus a short rationale. Powers Autofix F3's LLM merge flow.
 */

const BASE =
  (import.meta.env.VITE_TESTRUNNER_URL as string | undefined) ??
  'http://localhost:8787'

const DEFAULT_MODEL = 'gpt-4o-mini'

export interface MergeResult {
  merged: string
  reason: string
  cached: boolean
  durationMs: number
  model: string
}

interface ServerResponse {
  merged: string
  reason: string
  cached: boolean
  model: string
  durationMs: number
}

export async function mergeCluster(
  members: string[],
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<MergeResult> {
  const model = opts.model ?? DEFAULT_MODEL
  const res = await fetch(`${BASE}/merge-cluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members, model }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(
      `merge ${res.status}: ${(err as { detail?: string }).detail ?? res.statusText}`,
    )
  }
  const data = (await res.json()) as ServerResponse
  return {
    merged: data.merged,
    reason: data.reason,
    cached: data.cached,
    durationMs: data.durationMs,
    model: data.model,
  }
}
