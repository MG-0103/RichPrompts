import type { Diagnostic } from '@richprompt/core'

interface Props {
  diagnostics: Diagnostic[]
  onJump: (d: Diagnostic) => void
}

const severityGlyph = { error: '✕', warn: '▲', info: 'ⓘ' } as const

export function ProblemsPanel({ diagnostics, onJump }: Props) {
  if (diagnostics.length === 0) {
    return <div className="problems-panel empty">No problems detected.</div>
  }
  return (
    <div className="problems-panel">
      <div className="problems-header">
        {diagnostics.length} problem{diagnostics.length === 1 ? '' : 's'}
      </div>
      <ul>
        {diagnostics.map((d, i) => (
          <li key={i} className={`problem sev-${d.severity}`} onClick={() => onJump(d)}>
            <span className="glyph">{severityGlyph[d.severity]}</span>
            <span className="rule-id">{d.ruleId}</span>
            <span className="msg">{d.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
