import { defaultWeights, type ScoreBreakdown } from '@richprompt/core'
import type { Snapshot } from '../persistence/snapshots'
import { Sparkline } from './Sparkline'

interface Props {
  breakdown: ScoreBreakdown
  history: Snapshot[]
}

type Grade = { label: string; tone: 'good' | 'ok' | 'bad' }

function grade(score: number): Grade {
  if (score >= 90) return { label: 'Excellent', tone: 'good' }
  if (score >= 75) return { label: 'Good',      tone: 'good' }
  if (score >= 50) return { label: 'Needs work',tone: 'ok' }
  return { label: 'Broken', tone: 'bad' }
}

function buildTooltip(b: ScoreBreakdown): string {
  const w = defaultWeights
  const errPart = b.errorCount * w.error
  const warnPart = b.warnCount * w.warn
  const infoPart = b.infoCount * w.info
  const lines = [
    `Base                  ${w.base}`,
    `− ${padCount(b.errorCount)} error${plural(b.errorCount)} × ${w.error}    ${signed(-errPart)}`,
    `− ${padCount(b.warnCount)} warn${plural(b.warnCount)}  × ${w.warn}    ${signed(-warnPart)}`,
    `− ${padCount(b.infoCount)} info${plural(b.infoCount)}  × ${w.info}    ${signed(-infoPart)}`,
    `─────────────────────────`,
    `Score                 ${b.score}   (${grade(b.score).label})`,
  ]
  return lines.join('\n')
}

function padCount(n: number): string { return n.toString().padStart(2, ' ') }
function plural(n: number): string  { return n === 1 ? '' : 's' }
function signed(n: number): string {
  if (n === 0) return ' 0'
  return (n > 0 ? '+' : '') + n
}

export function ScoreBadge({ breakdown, history }: Props) {
  const values = history.map(h => h.score)
  const prev = history.length >= 2 ? history[history.length - 2].score : null
  const delta = prev == null ? null : breakdown.score - prev
  const g = grade(breakdown.score)
  const tooltip = buildTooltip(breakdown)
  return (
    <div className={`score-badge tone-${g.tone}`} title={tooltip}>
      <div className="score-num">
        <span className="value">{breakdown.score}</span>
        <span className={`grade-label grade-${g.tone}`}>{g.label}</span>
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
