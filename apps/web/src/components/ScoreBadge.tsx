import type { ScoreBreakdown } from '@richprompt/core'
import type { Snapshot } from '../persistence/snapshots'
import { Sparkline } from './Sparkline'

interface Props {
  breakdown: ScoreBreakdown
  history: Snapshot[]
}

function tone(score: number): string {
  if (score >= 85) return 'good'
  if (score >= 60) return 'ok'
  return 'bad'
}

export function ScoreBadge({ breakdown, history }: Props) {
  const values = history.map(h => h.score)
  const prev = history.length >= 2 ? history[history.length - 2].score : null
  const delta = prev == null ? null : breakdown.score - prev
  return (
    <div className={`score-badge tone-${tone(breakdown.score)}`}>
      <div className="score-num">
        <span className="value">{breakdown.score}</span>
        {delta != null && delta !== 0 && (
          <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>
            {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
          </span>
        )}
      </div>
      <div className="score-counts">
        {breakdown.errorCount > 0 && <span className="c-err">✕{breakdown.errorCount}</span>}
        {breakdown.warnCount > 0 && <span className="c-warn">▲{breakdown.warnCount}</span>}
        {breakdown.infoCount > 0 && <span className="c-info">ⓘ{breakdown.infoCount}</span>}
      </div>
      <Sparkline values={values} />
    </div>
  )
}
