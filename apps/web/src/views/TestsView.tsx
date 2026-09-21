import React, { useEffect, useState } from 'react'
import { ChevronRight, Loader2, Plus, X, Play, StopCircle, RotateCw, Trash2, Pin } from 'lucide-react'
import type { TestCase, TestResult, RolloutOutcome } from '@richprompt/core'
import type { SidecarStatus } from '@/hooks/useTests'
import type { CallTarget } from '@/testing/registry'
import type { TestingConfig } from '@/persistence/testConfig'
import type { RegistryPin } from '@/persistence/pins'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Textarea, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Props = {
  tests: TestCase[]
  results: Record<string, TestResult>
  baselineResults: Record<string, TestResult>
  loading: boolean
  error: string | null
  sidecar: SidecarStatus
  useMock: boolean
  onToggleMock: (v: boolean) => void
  runnerConfig: TestingConfig
  onRunnerConfig: (c: TestingConfig) => void
  targets: CallTarget[]
  pins: RegistryPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  onPinCurrent: () => void
  onRemovePin: (id: string) => void
  onClearBaseline: () => void
  onRunAll: () => void
  onRunOne: (id: string) => void
  onCancel: () => void
  onUpsert: (tc: TestCase) => void
  onRemove: (id: string) => void
  onReset: () => void
  onClearCache: () => void
}

export function TestsView(props: Props) {
  const {
    tests, results, baselineResults, loading, error, sidecar, useMock, onToggleMock,
    runnerConfig, onRunnerConfig, targets,
    pins, selectedPinId, onSelectPin, onPinCurrent, onRemovePin, onClearBaseline,
    onRunAll, onRunOne, onCancel, onUpsert, onRemove, onReset, onClearCache,
  } = props

  const selectedPin = pins.find(p => p.id === selectedPinId) ?? null
  const hasBaseline = !!selectedPin && Object.keys(baselineResults).length > 0
  const [editing, setEditing] = useState<TestCase | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const realReady = sidecar.state === 'up' && sidecar.real?.available === true

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex-wrap gap-x-3 gap-y-2">
            <span>Tests</span>
            <SidecarBadge status={sidecar} />
            <label
              className={cn(
                'flex items-center gap-1.5 text-xs font-normal',
                !realReady && !useMock && 'text-amber-500',
              )}
              title={realReady ? 'Toggle real Gemini calls vs. mock' : (sidecarReason(sidecar) ?? 'Real runner not available on this sidecar')}
            >
              <input
                type="checkbox"
                checked={!useMock}
                disabled={!realReady && useMock}
                onChange={e => onToggleMock(!e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span>real runner {realReady ? '' : '(unavailable)'}</span>
            </label>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowConfig(v => !v)}>
              {`${runnerConfig.rollouts}× · t=${runnerConfig.temperature} · ${runnerConfig.model}${runnerConfig.ablation ? ' · ablation' : ''}`}
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditing(BLANK_TEST())}>
                <Plus className="h-3 w-3" /> Add
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearCache} title="Force fresh runs">Clear cache</Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onReset} title="Restore seed tests">
                <RotateCw className="h-3 w-3" /> Reset
              </Button>
              {loading ? (
                <Button variant="destructive" size="sm" className="h-7 gap-1 text-xs" onClick={onCancel}>
                  <StopCircle className="h-3 w-3" /> Cancel
                </Button>
              ) : (
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={onRunAll}>
                  <Play className="h-3 w-3" /> Run all
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {showConfig && (
            <ConfigStrip config={runnerConfig} onChange={onRunnerConfig} onClose={() => setShowConfig(false)} />
          )}
          <BaselineStrip
            pins={pins}
            selectedPinId={selectedPinId}
            onSelect={onSelectPin}
            onPinCurrent={onPinCurrent}
            onRemovePin={onRemovePin}
            onClearBaseline={onClearBaseline}
            hasBaselineResults={hasBaseline}
          />
          {loading && <RunningBanner useMock={useMock} count={tests.length} baseline={!!selectedPin} />}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {sidecar.state === 'down' && !error && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Test runner sidecar not reachable. Start it with{' '}
              <code className="rounded bg-muted px-1 font-mono">uvicorn app.main:app --port 8787</code> in{' '}
              <code className="rounded bg-muted px-1 font-mono">services/testrunner</code>.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-4 py-1.5"></th>
                  <th className="py-1.5 pr-2 font-medium">id</th>
                  <th className="py-1.5 pr-2 font-medium">query</th>
                  <th className="py-1.5 pr-2 font-medium">expect</th>
                  <th className="py-1.5 pr-2 font-medium" title="Fraction of rollouts matching expect.">pass</th>
                  <th className="py-1.5 pr-2 text-right font-medium" title="Fraction of rollouts landing on the modal choice.">conc</th>
                  <th className="py-1.5 pr-2 font-medium" title="What the model picked most often.">modal</th>
                  <th className="py-1.5 pr-2 text-right font-medium">steps</th>
                  <th className="py-1.5 pr-2 text-right font-medium" title="p50 latency across rollouts, ms.">lat</th>
                  <th className="py-1.5 pr-2 text-right font-medium" title="0.7 * passRate + 0.3 * confidence-proxy.">score</th>
                  <th className="py-1.5 pr-2 text-right font-medium" title="passRate − stripped.passRate. Populated only when ablation ran.">desc-Δ</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {tests.map(t => {
                  const r = results[t.id]
                  const b = hasBaseline ? baselineResults[t.id] : undefined
                  const isOpen = expanded.has(t.id)
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        onClick={() => r && toggleExpand(t.id)}
                        className={cn('border-b border-border/40', r && 'cursor-pointer hover:bg-accent/40')}
                      >
                        <td className="py-1.5">
                          {r && (
                            <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                          )}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {t.id}
                          {r?.cached && <span className="ml-1 text-emerald-500" title="From cache">•</span>}
                        </td>
                        <td className="max-w-64 truncate py-1.5 pr-2">{t.query}</td>
                        <td className="py-1.5 pr-2 font-mono text-muted-foreground">{fmtExpect(t)}</td>
                        <td className="py-1.5 pr-2">
                          {r ? <PassBar rate={r.passRate} /> : <span className="text-muted-foreground">—</span>}
                          {b && r && <DeltaChip curr={r.passRate} base={b.passRate} scale={100} unit="pp" />}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {r ? (r.concentration * 100).toFixed(0) + '%' : <span className="text-muted-foreground">—</span>}
                          {b && r && <DeltaChip curr={r.concentration} base={b.concentration} scale={100} unit="pp" />}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">{r ? fmtModal(r.modalCalled, t) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{r ? r.meanSteps.toFixed(1) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{r ? Math.round(r.latencyP50) + 'ms' : <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">
                          {r ? (r.routingScore * 100).toFixed(0) : <span className="text-muted-foreground">—</span>}
                          {b && r && <DeltaChip curr={r.routingScore} base={b.routingScore} scale={100} unit="" />}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono">{fmtDelta(r)}</td>
                        <td className="py-1.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => onRunOne(t.id)}>run</Button>
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => setEditing({ ...t })}>edit</Button>
                            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-destructive" onClick={() => onRemove(t.id)}>del</Button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && r && (
                        <tr>
                          <td colSpan={12} className="bg-muted/20 px-3 py-2">
                            <RolloutTable rollouts={r.rollouts} test={t} label="full descriptions" />
                            {r.stripped && (
                              <>
                                <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  names only (descriptions stripped)
                                </div>
                                <RolloutTable rollouts={r.stripped.rollouts} test={t} label="stripped" />
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {tests.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-6 text-center text-sm text-muted-foreground">
                      No tests yet. Click "+ Add" to create one.
                    </td>
                  </tr>
                )}
              </tbody>
              <AblationSummary tests={tests} results={results} />
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <TestEditor
          initial={editing}
          existingIds={new Set(tests.map(t => t.id).filter(id => id !== editing.id))}
          targets={targets}
          onSave={tc => { onUpsert(tc); setEditing(null) }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ConfigStrip({
  config, onChange, onClose,
}: { config: TestingConfig; onChange: (c: TestingConfig) => void; onClose: () => void }) {
  const patch = (p: Partial<TestingConfig>) => onChange({ ...config, ...p })
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">rollouts</span>
        <input
          type="range" min={1} max={10} step={1}
          value={config.rollouts}
          onChange={e => patch({ rollouts: parseInt(e.target.value, 10) })}
        />
        <span className="w-4 font-mono">{config.rollouts}</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">temperature</span>
        <input
          type="range" min={0} max={1.5} step={0.1}
          value={config.temperature}
          onChange={e => patch({ temperature: parseFloat(e.target.value) })}
        />
        <span className="w-6 font-mono">{config.temperature.toFixed(1)}</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">model</span>
        <Input
          className="h-7 w-40 text-xs"
          value={config.model}
          onChange={e => patch({ model: e.target.value })}
          placeholder="gemini-2.5-flash"
        />
      </label>
      <label
        className="flex items-center gap-1.5"
        title="Run each test twice: once with real descriptions, once with them stripped."
      >
        <input
          type="checkbox"
          checked={config.ablation}
          onChange={e => patch({ ablation: e.target.checked })}
        />
        <span>names-only ablation</span>
      </label>
      <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={onClose}>close</Button>
    </div>
  )
}

function RunningBanner({ useMock, count, baseline }: { useMock: boolean; count: number; baseline: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    const started = performance.now()
    const id = setInterval(() => setElapsed(performance.now() - started), 200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-600 dark:text-sky-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Running {count} test{count === 1 ? '' : 's'}
      {baseline ? ' × 2 (vs. baseline)' : ''}
      {' '}({useMock ? 'mock' : 'real'}) · {(elapsed / 1000).toFixed(1)}s
    </div>
  )
}

function BaselineStrip({
  pins, selectedPinId, onSelect, onPinCurrent, onRemovePin, onClearBaseline, hasBaselineResults,
}: {
  pins: RegistryPin[]; selectedPinId: string | null
  onSelect: (id: string | null) => void; onPinCurrent: () => void
  onRemovePin: (id: string) => void; onClearBaseline: () => void
  hasBaselineResults: boolean
}) {
  const selected = pins.find(p => p.id === selectedPinId) ?? null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-muted-foreground">Baseline</span>
      <Select
        className="h-7 text-xs"
        value={selectedPinId ?? ''}
        onChange={e => {
          const id = e.target.value || null
          if (id !== selectedPinId) onClearBaseline()
          onSelect(id)
        }}
      >
        <option value="">— none —</option>
        {pins.slice().reverse().map(p => (
          <option key={p.id} value={p.id}>{p.label} ({fmtAge(p.timestamp)})</option>
        ))}
      </Select>
      {selected && (
        <Button
          variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive"
          onClick={() => { onRemovePin(selected.id); onClearBaseline() }}
          title="Delete this pin"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onPinCurrent} title="Save current prompt + registry as baseline">
        <Pin className="h-3 w-3" /> Pin current
      </Button>
      {hasBaselineResults && (
        <Badge variant="outline" className="text-[10px]">Δ = current − baseline</Badge>
      )}
      {pins.length === 0 && (
        <span className="text-muted-foreground">No pins yet — save one before editing to compare</span>
      )}
    </div>
  )
}

function DeltaChip({ curr, base, scale, unit }: { curr: number; base: number; scale: number; unit: string }) {
  const raw = (curr - base) * scale
  const tone = raw > 0.5 ? 'text-emerald-500' : raw < -0.5 ? 'text-red-500' : 'text-muted-foreground'
  const sign = raw > 0 ? '+' : ''
  const val = Math.abs(raw) < 1 ? raw.toFixed(1) : Math.round(raw).toString()
  return <span className={cn('ml-1 font-mono text-[10px]', tone)}>{sign}{val}{unit}</span>
}

function fmtAge(ts: number): string {
  const ms = Date.now() - ts
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}

function RolloutTable({ rollouts, test, label }: { rollouts: RolloutOutcome[]; test: TestCase; label?: string }) {
  return (
    <table className="w-full text-[11px]" data-label={label}>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-2 font-medium">#</th>
          <th className="py-1 pr-2 font-medium">called</th>
          <th className="py-1 pr-2 font-medium">latency</th>
          <th className="py-1 pr-2 font-medium">steps</th>
          <th className="py-1 font-medium">notes</th>
        </tr>
      </thead>
      <tbody>
        {rollouts.map((r, i) => {
          const passed = judgeOne(test, r)
          return (
            <tr key={i} className={cn('border-b border-border/30', passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
              <td className="py-1 pr-2 font-mono">{i + 1}</td>
              <td className="py-1 pr-2 font-mono">{fmtCall(r.called)}</td>
              <td className="py-1 pr-2 font-mono">{Math.round(r.latencyMs)}ms</td>
              <td className="py-1 pr-2 font-mono">{r.steps}</td>
              <td className="py-1">{r.error ? <span>{r.error}</span> : (passed ? '' : 'mismatch')}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function judgeOne(test: TestCase, r: RolloutOutcome): boolean {
  if (r.error || !r.called) return false
  const c = r.called
  const e = test.expect
  if (e.kind === 'none') return c.kind === 'none'
  return c.kind === e.kind && c.name === e.name
}

function fmtCall(c: RolloutOutcome['called']): string {
  if (!c) return 'error'
  if (c.kind === 'none') return '∅ no call'
  return `${c.kind}:${c.name}`
}

function sidecarReason(status: SidecarStatus): string | undefined {
  if (status.state !== 'up') return undefined
  return status.real?.reason ?? undefined
}

function SidecarBadge({ status }: { status: SidecarStatus }) {
  if (status.state === 'up') {
    const label = status.mode ?? 'up'
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
        title={sidecarReason(status) ?? undefined}
      >
        sidecar: {label}{status.version && ` v${status.version}`}
      </Badge>
    )
  }
  if (status.state === 'down') {
    return <Badge variant="outline" className="border-red-500/40 text-red-500">sidecar: offline</Badge>
  }
  return <Badge variant="outline" className="text-muted-foreground">sidecar: …</Badge>
}

function PassBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const tone = rate >= 0.8 ? 'bg-emerald-500' : rate >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="relative inline-flex h-4 w-16 items-center overflow-hidden rounded-sm bg-muted">
      <div className={cn('h-full', tone)} style={{ width: `${pct}%` }} />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-foreground mix-blend-difference">{pct}%</span>
    </div>
  )
}

function fmtExpect(t: TestCase): string {
  if (t.expect.kind === 'none') return '∅ no call'
  return `${t.expect.kind}:${t.expect.name}`
}

function fmtModal(called: TestResult['modalCalled'], test: TestCase): React.ReactNode {
  if (!called) return <span className="text-muted-foreground">—</span>
  const label = called.kind === 'none' ? '∅ no call' : `${called.kind}:${called.name}`
  const expected = test.expect
  const match = expected.kind === 'none' ? called.kind === 'none' : (called.kind === expected.kind && called.name === expected.name)
  return <span className={match ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{label}</span>
}

function fmtDelta(r: TestResult | undefined): React.ReactNode {
  if (!r || !r.stripped) return <span className="text-muted-foreground">—</span>
  const delta = r.passRate - r.stripped.passRate
  const tone = delta >= 0.2 ? 'text-emerald-500 font-semibold' : delta > 0 ? 'text-emerald-500' : delta < -0.1 ? 'text-red-500' : 'text-muted-foreground'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={tone} title={`full: ${(r.passRate * 100).toFixed(0)}%  ·  stripped: ${(r.stripped.passRate * 100).toFixed(0)}%`}>
      {sign}{(delta * 100).toFixed(0)}
    </span>
  )
}

function AblationSummary({ tests, results }: { tests: TestCase[]; results: Record<string, TestResult> }) {
  const withAblation = tests
    .map(t => results[t.id])
    .filter((r): r is TestResult => !!r?.stripped)
  if (withAblation.length === 0) return null
  const deltas = withAblation.map(r => r.passRate - (r.stripped?.passRate ?? 0))
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
  const high = deltas.filter(d => d >= 0.2).length
  const negative = deltas.filter(d => d < 0).length
  return (
    <tfoot>
      <tr className="border-t border-border">
        <td colSpan={12} className="py-2">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="font-medium text-muted-foreground">descriptions doing work</span>
            <span>mean Δ <span className="font-mono">{(mean * 100).toFixed(0)}pp</span></span>
            <span>high (≥20pp) <span className="font-mono">{high}/{withAblation.length}</span></span>
            {negative > 0 && (
              <span className="text-amber-500">
                stripped scored higher on <span className="font-mono">{negative}</span> — likely misleading descriptions
              </span>
            )}
          </div>
        </td>
      </tr>
    </tfoot>
  )
}

function BLANK_TEST(): TestCase {
  return {
    id: `test-${Date.now().toString(36)}`,
    query: '',
    expect: { kind: 'tool', name: '' },
  }
}

function TestEditor({
  initial, existingIds, targets, onSave, onCancel,
}: {
  initial: TestCase; existingIds: Set<string>; targets: CallTarget[]
  onSave: (t: TestCase) => void; onCancel: () => void
}) {
  const [id, setId] = useState(initial.id)
  const [query, setQuery] = useState(initial.query)
  const [expectKind, setExpectKind] = useState<'tool' | 'skill' | 'none'>(initial.expect.kind)
  const [expectName, setExpectName] = useState(initial.expect.kind === 'none' ? '' : initial.expect.name)
  const [notes, setNotes] = useState(initial.notes ?? '')

  const availableNames = targets.filter(t => t.kind === expectKind).map(t => t.name)
  const nameInRegistry = availableNames.includes(expectName)

  const idError = !id.trim() ? 'id required' : existingIds.has(id.trim()) ? 'id already used' : null
  const queryError = !query.trim() ? 'query required' : null
  const nameError = expectKind !== 'none' && !expectName.trim() ? 'name required' : null
  const valid = !idError && !queryError && !nameError

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{initial.query ? 'Edit test' : 'New test'}</div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="h-4 w-4" /></Button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">id</span>
          <Input value={id} onChange={e => setId(e.target.value)} />
          {idError && <span className="text-[11px] text-red-500">{idError}</span>}
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">query</span>
          <Textarea value={query} rows={3} onChange={e => setQuery(e.target.value)} />
          {queryError && <span className="text-[11px] text-red-500">{queryError}</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">expect kind</span>
            <Select
              value={expectKind}
              onChange={e => setExpectKind(e.target.value as 'tool' | 'skill' | 'none')}
              className="w-full"
            >
              <option value="tool">tool</option>
              <option value="skill">skill</option>
              <option value="none">none (no call)</option>
            </Select>
          </label>
          {expectKind !== 'none' && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                name{!nameInRegistry && expectName ? ' ⚠︎' : ''}
              </span>
              <Input
                list={`ef-names-${expectKind}`}
                value={expectName}
                onChange={e => setExpectName(e.target.value)}
                placeholder={availableNames[0] ?? `e.g. get_weather`}
              />
              <datalist id={`ef-names-${expectKind}`}>
                {availableNames.map(n => <option key={n} value={n} />)}
              </datalist>
              {nameError && <span className="text-[11px] text-red-500">{nameError}</span>}
              {!nameError && expectName && !nameInRegistry && (
                <span className="text-[11px] text-amber-500">not in current registry — the model may not know about it</span>
              )}
            </label>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">notes (optional)</span>
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => onSave({
              id: id.trim(),
              query: query.trim(),
              expect: expectKind === 'none' ? { kind: 'none' } : { kind: expectKind, name: expectName.trim() },
              notes: notes.trim() || undefined,
            })}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
