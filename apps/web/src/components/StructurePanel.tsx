import type { CanonicalSection, StructureReport } from '@richprompt/core'

interface Props {
  report: StructureReport
  onJump: (offset: number) => void
}

const SECTION_COLORS: Record<CanonicalSection, string> = {
  role:        '#4a8fd6',
  task:        '#5ab671',
  output:      '#9a6ad9',
  constraints: '#d69a3a',
}
const OTHER_COLOR = '#555'

export function StructurePanel({ report, onJump }: Props) {
  const { budget, sections, chars, approxTokens } = report
  return (
    <div className="structure-panel">
      <BudgetBar budget={budget} chars={chars} approxTokens={approxTokens} />
      <SectionStack sections={sections} totalChars={chars} onJump={onJump} />
      <SectionList sections={sections} onJump={onJump} />
    </div>
  )
}

function BudgetBar({
  budget,
  chars,
  approxTokens,
}: {
  budget: StructureReport['budget']
  chars: number
  approxTokens: number
}) {
  const capped = Math.min(200, budget.percentUsed)
  return (
    <div className="budget-bar-wrap">
      <div className="budget-line">
        <span className="budget-nums">
          <strong>{chars.toLocaleString()}</strong> chars
          <span className="dim"> · </span>
          <strong>~{approxTokens.toLocaleString()}</strong> tokens
          <span className="dim"> · </span>
          <span title="Approximation (chars / 4). Real tokenization may differ up to 40% for code/JSON-heavy text.">
            <strong>{budget.percentUsed}%</strong> of {budget.model} practical budget
          </span>
        </span>
        <span className={`budget-tone tone-${budget.tone}`}>{toneLabel(budget.tone)}</span>
      </div>
      <div className="budget-track">
        <div className={`budget-fill tone-${budget.tone}`} style={{ width: `${capped / 2}%` }} />
        <div className="budget-marker" style={{ left: '50%' }} title="100% = practical budget" />
      </div>
      <div className="budget-context dim">
        Context window: {budget.contextWindow.toLocaleString()} tokens · practical:{' '}
        {budget.practicalTokens.toLocaleString()}
      </div>
    </div>
  )
}

function toneLabel(t: 'good' | 'ok' | 'bad'): string {
  if (t === 'good') return 'comfortable'
  if (t === 'ok')   return 'over budget'
  return 'far over budget'
}

function SectionStack({
  sections,
  totalChars,
  onJump,
}: {
  sections: StructureReport['sections']
  totalChars: number
  onJump: (offset: number) => void
}) {
  if (totalChars === 0 || sections.length === 0) return null
  const uncounted = totalChars - sections.reduce((a, s) => a + s.chars, 0)
  return (
    <div className="section-stack">
      <div className="section-stack-title">Section proportions</div>
      <div className="section-stack-bar">
        {sections.map(s => (
          <button
            key={`${s.canonical ?? 'other'}-${s.heading ?? ''}-${s.startOffset}`}
            className="section-seg"
            style={{
              flexBasis: `${s.fraction * 100}%`,
              background: colorFor(s.canonical),
            }}
            title={`${labelFor(s)} — ${s.chars.toLocaleString()} chars (${Math.round(s.fraction * 100)}%)`}
            onClick={() => onJump(s.startOffset)}
          />
        ))}
        {uncounted > 0 && (
          <div
            className="section-seg gap"
            style={{ flexBasis: `${(uncounted / totalChars) * 100}%` }}
            title={`${uncounted.toLocaleString()} chars outside detected sections`}
          />
        )}
      </div>
      <Legend sections={sections} />
    </div>
  )
}

function Legend({ sections }: { sections: StructureReport['sections'] }) {
  const canonicals = Array.from(
    new Set(sections.map(s => s.canonical).filter((c): c is CanonicalSection => !!c)),
  )
  const hasOther = sections.some(s => !s.canonical)
  return (
    <div className="section-legend">
      {canonicals.map(c => (
        <span key={c} className="legend-dot" style={{ background: SECTION_COLORS[c] }}>
          <span className="legend-label">{c}</span>
        </span>
      ))}
      {hasOther && (
        <span className="legend-dot" style={{ background: OTHER_COLOR }}>
          <span className="legend-label">other</span>
        </span>
      )}
    </div>
  )
}

function SectionList({
  sections,
  onJump,
}: {
  sections: StructureReport['sections']
  onJump: (offset: number) => void
}) {
  if (sections.length === 0) {
    return <div className="section-empty">No headings or XML sections detected — the whole prompt is one flat block.</div>
  }
  const largest = sections.reduce((a, s) => s.chars > a.chars ? s : a, sections[0])
  return (
    <div className="section-list">
      <div className="section-list-title">Sections ({sections.length})</div>
      <table className="section-table">
        <thead>
          <tr>
            <th></th>
            <th>section</th>
            <th>chars</th>
            <th>~tokens</th>
            <th>share</th>
            <th>¶</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => (
            <tr
              key={i}
              className={s === largest ? 'largest' : ''}
              onClick={() => onJump(s.startOffset)}
            >
              <td>
                <span className="section-swatch" style={{ background: colorFor(s.canonical) }} />
              </td>
              <td>
                <span className="section-name">{labelFor(s)}</span>
                {s === largest && <span className="tag-largest">largest</span>}
              </td>
              <td className="mono">{s.chars.toLocaleString()}</td>
              <td className="mono">{s.approxTokens.toLocaleString()}</td>
              <td className="mono">{Math.round(s.fraction * 100)}%</td>
              <td className="mono">{s.paragraphCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function labelFor(s: StructureReport['sections'][number]): string {
  if (s.canonical && s.heading) return `${s.canonical} · ${s.heading}`
  if (s.canonical) return s.canonical
  if (s.heading) return s.heading
  return '(uncategorized)'
}

function colorFor(canonical: CanonicalSection | undefined): string {
  return canonical ? SECTION_COLORS[canonical] : OTHER_COLOR
}
