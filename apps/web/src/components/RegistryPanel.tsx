import type { RegistryFinding } from '@richprompt/core'

interface Props {
  findings: RegistryFinding[]
  onRescan: () => void
}

export function RegistryPanel({ findings, onRescan }: Props) {
  return (
    <div className="registry-panel">
      <div className="registry-header">
        <span>Registry — {findings.length} issue{findings.length === 1 ? '' : 's'}</span>
        <button className="rescan-btn" onClick={onRescan}>Rescan</button>
      </div>
      {findings.length === 0 ? (
        <div className="registry-empty">No overlaps detected.</div>
      ) : (
        <ul>
          {findings.map((f, i) => (
            <li key={i} className={`registry-item sev-${f.severity}`}>
              <div className="registry-title">
                <span className="score">{(f.score * 100).toFixed(0)}%</span>
                <code>{f.docIds[0]}</code>
                <span className="vs">↔</span>
                <code>{f.docIds[1]}</code>
              </div>
              <div className="registry-msg">{f.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
