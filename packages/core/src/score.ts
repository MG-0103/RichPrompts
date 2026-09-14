import type { Diagnostic } from './types'

export interface ScoreWeights {
  error: number
  warn: number
  info: number
  base: number
}

export const defaultWeights: ScoreWeights = {
  base: 100,
  error: 10,
  warn: 3,
  info: 1,
}

export interface ScoreBreakdown {
  score: number
  errorCount: number
  warnCount: number
  infoCount: number
}

export function scoreDiagnostics(
  diagnostics: Diagnostic[],
  weights: ScoreWeights = defaultWeights,
): ScoreBreakdown {
  let e = 0, w = 0, i = 0
  for (const d of diagnostics) {
    if (d.severity === 'error') e++
    else if (d.severity === 'warn') w++
    else i++
  }
  const raw = weights.base - e * weights.error - w * weights.warn - i * weights.info
  return {
    score: Math.max(0, raw),
    errorCount: e,
    warnCount: w,
    infoCount: i,
  }
}

export function hashContent(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return h >>> 0
}
