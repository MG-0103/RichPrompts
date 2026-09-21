import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Info,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  XCircle,
} from 'lucide-react'
import {
  isDiagnosticFixable,
  type CanonicalSection,
  type Diagnostic,
  type Section,
  type Severity,
} from '@richprompt/core'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  diagnostics: Diagnostic[]
  sections: Section[]
  onJump?: (d: Diagnostic) => void
  /** Fires when the user hovers or leaves a diagnostic row. Used by the
   *  Preview pane to highlight the span in the rendered output. */
  onHoverDiagnostic?: (d: Diagnostic | null) => void
  onFixDiagnostic?: (d: Diagnostic) => void
}

type GroupMode = 'severity' | 'rule' | 'section'
type SectionBucket = CanonicalSection | 'other'

const SEV_META: Record<
  Severity,
  { icon: typeof AlertTriangle; label: string; className: string }
> = {
  error: { icon: XCircle, label: 'Errors', className: 'text-red-500' },
  warn: { icon: AlertTriangle, label: 'Warnings', className: 'text-amber-500' },
  info: { icon: Info, label: 'Info', className: 'text-sky-500' },
}

const SEVERITY_ORDER: Severity[] = ['error', 'warn', 'info']
const SECTION_ORDER: SectionBucket[] = ['role', 'task', 'output', 'constraints', 'other']

export function ProblemsStrip({
  diagnostics,
  sections,
  onJump,
  onHoverDiagnostic,
  onFixDiagnostic,
}: Props) {
  const [expanded, setExpanded] = useState(false)
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
        .map(s => ({ key: s, label: SEV_META[s].label, items: buckets.get(s)! }))
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

  const toggleGroup = (key: string) =>
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

  const total = diagnostics.length

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <button
        className="flex h-8 w-full items-center gap-3 px-3 text-xs hover:bg-accent/40"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="font-medium">Problems</span>
        <Badge variant={total === 0 ? 'outline' : 'secondary'} className="h-5 px-1.5">
          {total}
        </Badge>
        <div className="flex items-center gap-2 text-muted-foreground">
          {SEVERITY_ORDER.map(sev => {
            const Icon = SEV_META[sev].icon
            return (
              <span key={sev} className="flex items-center gap-1">
                <Icon className={cn('h-3.5 w-3.5', SEV_META[sev].className)} />
                <span>{counts[sev]}</span>
              </span>
            )
          })}
        </div>
        <span className="ml-auto text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">
              {filtered.length} of {total} problem{total === 1 ? '' : 's'}
            </span>
            <div className="ml-2 flex items-center gap-1">
              {SEVERITY_ORDER.map(sev => {
                const Icon = SEV_META[sev].icon
                const isMuted = muted.has(sev)
                return (
                  <button
                    key={sev}
                    onClick={() => toggleMute(sev)}
                    className={cn(
                      'flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-opacity',
                      isMuted && 'opacity-40',
                    )}
                    title={isMuted ? `Show ${sev}` : `Hide ${sev}`}
                  >
                    <Icon className={cn('h-3 w-3', SEV_META[sev].className)} />
                    <span className="font-mono">{counts[sev]}</span>
                  </button>
                )
              })}
            </div>
            <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {(['severity', 'rule', 'section'] as GroupMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                    mode === m
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {total === 0 ? 'No problems detected.' : 'All problems muted by filter.'}
              </div>
            ) : (
              groups.map(group => {
                const isCollapsed = collapsed.has(group.key)
                return (
                  <div key={group.key} className="border-b border-border/60 last:border-b-0">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent/30"
                      onClick={() => toggleGroup(group.key)}
                    >
                      <ChevronRight
                        className={cn(
                          'h-3 w-3 text-muted-foreground transition-transform',
                          !isCollapsed && 'rotate-90',
                        )}
                      />
                      <span className="font-medium">{group.label}</span>
                      <span className="text-muted-foreground">{group.items.length}</span>
                    </button>
                    {!isCollapsed && (
                      <ul>
                        {group.items.map((d, i) => {
                          const Icon = SEV_META[d.severity].icon
                          return (
                            <li
                              key={`${group.key}-${i}`}
                              className="flex items-start gap-2 px-3 py-1 pl-8 text-xs hover:bg-accent/30"
                              onMouseEnter={() => onHoverDiagnostic?.(d)}
                              onMouseLeave={() => onHoverDiagnostic?.(null)}
                            >
                              <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', SEV_META[d.severity].className)} />
                              <div className="min-w-0 flex-1">
                                {mode !== 'rule' && (
                                  <span className="mr-2 font-mono text-muted-foreground">{d.ruleId}</span>
                                )}
                                {mode === 'rule' && (
                                  <span className="mr-2 font-mono text-muted-foreground">@{d.range.startOffset}</span>
                                )}
                                <span>{d.message}</span>
                              </div>
                              {onFixDiagnostic && isDiagnosticFixable(d) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-5 shrink-0 px-1.5 text-[10px]"
                                  onClick={() => onFixDiagnostic(d)}
                                  title={d.fix}
                                >
                                  Fix
                                </Button>
                              )}
                              {onJump && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 shrink-0 px-1.5 text-[10px]"
                                  onClick={() => onJump(d)}
                                >
                                  Jump
                                </Button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
