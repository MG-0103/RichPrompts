import type { BudgetInfo } from './types'

/**
 * Per-model practical attention budgets. `context` is the raw window;
 * `practical` is a rough ceiling above which authors should assume
 * attention degrades noticeably. These are folk-wisdom numbers pulled
 * from lost-in-the-middle-style empirical work and community reports,
 * not published spec. Users can override in the Tests config.
 */
const MODEL_BUDGETS: Record<string, { context: number; practical: number }> = {
  'gemini-2.5-flash':  { context: 1_048_576, practical: 32_000 },
  'gemini-2.5-pro':    { context: 2_097_152, practical: 64_000 },
  'gemini-1.5-flash':  { context: 1_048_576, practical: 24_000 },
  'gemini-1.5-pro':    { context: 2_097_152, practical: 48_000 },
  'claude-sonnet-5':   { context: 200_000,   practical: 40_000 },
  'claude-opus-5':     { context: 200_000,   practical: 60_000 },
  'claude-haiku-4-5':  { context: 200_000,   practical: 24_000 },
  'gpt-4o':            { context: 128_000,   practical: 24_000 },
  'gpt-4o-mini':       { context: 128_000,   practical: 20_000 },
  'gpt-4-turbo':       { context: 128_000,   practical: 24_000 },
}

/** Rough estimator. ~4 chars per token averages fine for English prose;
 *  code and JSON skew lower. Good enough for a budget bar; a real
 *  tokenizer only if this becomes decision-blocking. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

export function budgetFor(chars: number, model: string): BudgetInfo {
  const b =
    MODEL_BUDGETS[model] ??
    // Fallback: assume a modest 128k-context model.
    { context: 128_000, practical: 20_000 }
  const approxTokens = estimateTokens(chars)
  const pct = (approxTokens / b.practical) * 100
  const percentUsed = Math.min(400, Math.round(pct))
  const tone: BudgetInfo['tone'] = pct <= 60 ? 'good' : pct <= 100 ? 'ok' : 'bad'
  return {
    model,
    contextWindow: b.context,
    practicalTokens: b.practical,
    approxTokens,
    percentUsed,
    tone,
  }
}
