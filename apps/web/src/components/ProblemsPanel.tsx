import { useMemo, useState } from 'react'
import type { CanonicalSection, Diagnostic, Section, Severity } from '@richprompt/core'

interface Props {
  diagnostics: Diagnostic[]
  sections: Section[]
  onJump: (d: Diagnostic) => void
}

const severityGlyph = { error: '✕', warn: '▲', info: 'ⓘ' } as const
const SEVERITY_ORDER: Severity[] = ['error', 'warn', 'info']

type GroupMode = 'severity' | 'rule' | 'section'
type SectionBucket = CanonicalSection | 'other'
const SECTION_ORDER: SectionBucket[] = ['role', 'task', 'output', 'constraints', 'other']

export function ProblemsPanel({ diagnostics, sections, onJump }: Props) {
  const [mode, setMode] = useState<GroupMode>('severity')
  const [muted, setMuted] = useState<Set<Severity>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['info']))

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warn: 0, info: 0 }
    for (const d of diagnostics) c[d.severity]++
    return c
  }, [diagnostics])

  const filtered = useMemo(
    () => diagnostics.filter(d => !muted.has(d.severity)),
    [diagnostics, muted],
  )

  const sectionOf = useMemo(() => {
    const canonicals = sections.filter(s => s.canonical)
    return (d: Diagnostic): SectionBucket => {
      const off = d.range.startOffset
      for (const s of canonicals) {
        if (off >= s.startOffset && off < s.endOffset) return s.canonical!
      }
      return 'other'
    }
  }, [sections])

  const groups = useMemo(() => {
    if (filtered.length === 0) return []
    if (mode === 'severity') {
      const buckets = new Map<string, Diagnostic[]>()
      for (const d of filtered) {
        if (!buckets.has(d.severity)) buckets.set(d.severity, [])
        buckets.get(d.severity)!.push(d)
      }
      return SEVERITY_ORDER
        .filter(s => buckets.has(s))
        .map(s => ({ key: s, label: severityLabel(s), items: buckets.get(s)! }))
    }
    if (mode === 'rule') {
      const buckets = new Map<string, Diagnostic[]>()
      for (const d of filtered) {
        if (!buckets.has(d.ruleId)) buckets.set(d.ruleId, [])
        buckets.get(d.ruleId)!.push(d)
      }
      return Array.from(buckets.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .map(([id, items]) => ({ key: `rule:${id}`, label: id, items }))
    }
    // section mode
    const buckets = new Map<SectionBucket, Diagnostic[]>()
    for (const d of filtered) {
      const b = sectionOf(d)
      if (!buckets.has(b)) buckets.set(b, [])
      buckets.get(b)!.push(d)
    }
    return SECTION_ORDER
      .filter(k => buckets.has(k))
      .map(k => ({ key: `sec:${k}`, label: k === 'other' ? 'Other' : k, items: buckets.get(k)! }))
  }, [filtered, mode, sectionOf])

  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const toggleMute = (s: Severity) =>
    setMuted(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })

  if (diagnostics.length === 0) {
    return <div className="problems-panel empty">No problems detected.</div>
  }

  return (
    <div className="problems-panel">
      <div className="problems-header">
        <span className="problems-count">
          {filtered.length} of {diagnostics.length} problem{diagnostics.length === 1 ? '' : 's'}
        </span>

        <div className="filter-chips">
          {SEVERITY_ORDER.map(s => (
            <button
              key={s}
              className={`chip sev-${s} ${muted.has(s) ? 'muted' : ''}`}
              onClick={() => toggleMute(s)}
              title={muted.has(s) ? `Show ${s}` : `Hide ${s}`}
            >
              {severityGlyph[s]} {counts[s]}
            </button>
          ))}
        </div>

        <div className="group-mode" role="tablist">
          {(['severity', 'rule', 'section'] as GroupMode[]).map(m => (
            <button
              key={m}
              className={`gm-btn ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {groups.map(group => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="problem-group">
            <button
              className="group-header"
              onClick={() => toggle(group.key)}
            >
              <span className={`chev ${isCollapsed ? '' : 'open'}`}>▸</span>
              <span className="group-label">{group.label}</span>
              <span className="group-count">{group.items.length}</span>
            </button>
            {!isCollapsed && (
              <ul>
                {group.items.map((d, i) => (
                  <li
                    key={`${group.key}-${i}`}
                    className={`problem sev-${d.severity}`}
                    onClick={() => onJump(d)}
                  >
                    <span className="glyph">{severityGlyph[d.severity]}</span>
                    {mode !== 'rule' && <span className="rule-id">{d.ruleId}</span>}
                    {mode === 'rule' && <span className="rule-id offset">{fmtOffset(d.range.startOffset)}</span>}
                    <span className="msg">{d.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function severityLabel(s: Severity): string {
  return s === 'error' ? 'Errors' : s === 'warn' ? 'Warnings' : 'Info'
}

function fmtOffset(off: number): string {
  return `@${off}`
}
