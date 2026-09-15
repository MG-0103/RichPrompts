import React, { useEffect, useState } from 'react'
import type { TestCase, TestResult, RolloutOutcome } from '@richprompt/core'
import type { SidecarStatus } from '../hooks/useTests'
import type { CallTarget } from '../testing/registry'
import type { TestingConfig } from '../persistence/testConfig'

type Props = {
  tests: TestCase[]
  results: Record<string, TestResult>
  loading: boolean
  error: string | null
  sidecar: SidecarStatus
  useMock: boolean
  onToggleMock: (v: boolean) => void
  runnerConfig: TestingConfig
  onRunnerConfig: (c: TestingConfig) => void
  targets: CallTarget[]
  onRunAll: () => void
  onRunOne: (id: string) => void
  onCancel: () => void
  onUpsert: (tc: TestCase) => void
  onRemove: (id: string) => void
  onReset: () => void
  onClearCache: () => void
}

export function TestsPanel({
  tests, results, loading, error, sidecar, useMock, onToggleMock,
  runnerConfig, onRunnerConfig, targets,
  onRunAll, onRunOne, onCancel, onUpsert, onRemove, onReset, onClearCache,
}: Props) {
  const [editing, setEditing] = useState<TestCase | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const realReady = sidecar.state === 'up' && sidecar.real?.available === true

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="tests-panel">
      <div className="tests-header">
        <span>Tests</span>
        <SidecarBadge status={sidecar} />
        <label
          className={`runner-toggle ${!realReady && !useMock ? 'warn' : ''}`}
          title={realReady ? 'Toggle real Gemini calls vs. mock' : (sidecarReason(sidecar) ?? 'Real runner not available on this sidecar')}
        >
          <input
            type="checkbox"
            checked={!useMock}
            disabled={!realReady && useMock}
            onChange={e => onToggleMock(!e.target.checked)}
          />
          <span>real runner {realReady ? '' : '(unavailable)'}</span>
        </label>
        <button className="chip-btn" onClick={() => setShowConfig(v => !v)}>
          {`${runnerConfig.rollouts}× · t=${runnerConfig.temperature} · ${runnerConfig.model}${runnerConfig.ablation ? ' · ablation' : ''}`}
        </button>
        <div className="tests-actions">
          <button className="rescan-btn" onClick={() => setEditing(BLANK_TEST())}>+ Add</button>
          <button className="rescan-btn" onClick={onClearCache} title="Force fresh runs">Clear cache</button>
          <button className="rescan-btn" onClick={onReset} title="Restore seed tests">Reset</button>
          {loading ? (
            <button className="rescan-btn danger" onClick={onCancel}>Cancel</button>
          ) : (
            <button className="rescan-btn" onClick={onRunAll}>Run all</button>
          )}
        </div>
      </div>

      {showConfig && (
        <ConfigStrip
          config={runnerConfig}
          onChange={onRunnerConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
      {loading && <RunningBanner useMock={useMock} count={tests.length} />}
      {error && <div className="tests-error">{error}</div>}
      {sidecar.state === 'down' && !error && (
        <div className="tests-hint">
          Test runner sidecar not reachable. Start it with{' '}
          <code>uvicorn app.main:app --port 8787</code> in{' '}
          <code>services/testrunner</code>.
        </div>
      )}

      <table className="tests-table">
        <thead>
          <tr>
            <th></th>
            <th>id</th>
            <th>query</th>
            <th>expect</th>
            <th title="Fraction of rollouts matching expect.">pass</th>
            <th title="Fraction of rollouts landing on the modal choice.">conc</th>
            <th title="What the model picked most often.">modal</th>
            <th>steps</th>
            <th title="p50 latency across rollouts, ms.">lat</th>
            <th title="0.7 * passRate + 0.3 * confidence-proxy.">score</th>
            <th title="passRate − stripped.passRate. High delta = descriptions doing real work. Only populated when ablation was enabled for the run.">desc-Δ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tests.map(t => {
            const r = results[t.id]
            const isOpen = expanded.has(t.id)
            return (
              <React.Fragment key={t.id}>
                <tr onClick={() => r && toggleExpand(t.id)} className={r ? 'clickable' : ''}>
                  <td className="expand-cell">
                    {r ? <span className={`chev ${isOpen ? 'open' : ''}`}>▸</span> : ''}
                  </td>
                  <td className="t-id">
                    {t.id}
                    {r?.cached && <span className="cached-dot" title="From cache">•</span>}
                  </td>
                  <td className="t-q">{t.query}</td>
                  <td className="t-exp">{fmtExpect(t)}</td>
                  <td>{r ? <PassBar rate={r.passRate} /> : <span className="dim">—</span>}</td>
                  <td className="mono">{r ? (r.concentration * 100).toFixed(0) + '%' : <span className="dim">—</span>}</td>
                  <td className="t-exp">{r ? fmtModal(r.modalCalled, t) : <span className="dim">—</span>}</td>
                  <td className="mono">{r ? r.meanSteps.toFixed(1) : <span className="dim">—</span>}</td>
                  <td className="mono">{r ? Math.round(r.latencyP50) + 'ms' : <span className="dim">—</span>}</td>
                  <td className="mono">{r ? (r.routingScore * 100).toFixed(0) : <span className="dim">—</span>}</td>
                  <td className="mono">{fmtDelta(r)}</td>
                  <td className="t-actions" onClick={e => e.stopPropagation()}>
                    <button className="link-btn" onClick={() => onRunOne(t.id)}>run</button>
                    <button className="link-btn" onClick={() => setEditing({ ...t })}>edit</button>
                    <button className="link-btn danger" onClick={() => onRemove(t.id)}>del</button>
                  </td>
                </tr>
                {isOpen && r && (
                  <tr className="rollout-row">
                    <td colSpan={12}>
                      <RolloutTable rollouts={r.rollouts} test={t} label="full descriptions" />
                      {r.stripped && (
                        <>
                          <div className="rollout-sub">names only (descriptions stripped)</div>
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
            <tr><td colSpan={12} className="tests-empty">No tests yet. Click "+ Add" to create one.</td></tr>
          )}
        </tbody>
        <AblationSummary tests={tests} results={results} />
      </table>

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
  config,
  onChange,
  onClose,
}: {
  config: TestingConfig
  onChange: (c: TestingConfig) => void
  onClose: () => void
}) {
  const patch = (p: Partial<TestingConfig>) => onChange({ ...config, ...p })
  return (
    <div className="config-strip">
      <label>
        <span>rollouts</span>
        <input
          type="range" min={1} max={10} step={1}
          value={config.rollouts}
          onChange={e => patch({ rollouts: parseInt(e.target.value, 10) })}
        />
        <span className="mono">{config.rollouts}</span>
      </label>
      <label>
        <span>temperature</span>
        <input
          type="range" min={0} max={1.5} step={0.1}
          value={config.temperature}
          onChange={e => patch({ temperature: parseFloat(e.target.value) })}
        />
        <span className="mono">{config.temperature.toFixed(1)}</span>
      </label>
      <label>
        <span>model</span>
        <input
          type="text"
          value={config.model}
          onChange={e => patch({ model: e.target.value })}
          placeholder="gemini-2.5-flash"
        />
      </label>
      <label
        className="ablation-toggle"
        title="Run each test twice: once with real descriptions, once with them stripped. desc-Δ tells you how much the description is doing vs. the name alone. Doubles the call count."
      >
        <input
          type="checkbox"
          checked={config.ablation}
          onChange={e => patch({ ablation: e.target.checked })}
        />
        <span>names-only ablation</span>
      </label>
      <button className="link-btn" onClick={onClose}>close</button>
    </div>
  )
}

function RunningBanner({ useMock, count }: { useMock: boolean; count: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    const started = performance.now()
    const id = setInterval(() => setElapsed(performance.now() - started), 200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="running-banner">
      <span className="spinner" /> Running {count} test{count === 1 ? '' : 's'}
      {' '}({useMock ? 'mock' : 'real'}) · {(elapsed / 1000).toFixed(1)}s
    </div>
  )
}

function RolloutTable({
  rollouts,
  test,
  label,
}: {
  rollouts: RolloutOutcome[]
  test: TestCase
  label?: string
}) {
  return (
    <table className="rollout-table" data-label={label}>
      <thead>
        <tr><th>#</th><th>called</th><th>latency</th><th>steps</th><th>notes</th></tr>
      </thead>
      <tbody>
        {rollouts.map((r, i) => {
          const passed = judgeOne(test, r)
          return (
            <tr key={i} className={passed ? 'rp-pass' : 'rp-fail'}>
              <td className="mono">{i + 1}</td>
              <td className="mono">{fmtCall(r.called)}</td>
              <td className="mono">{Math.round(r.latencyMs)}ms</td>
              <td className="mono">{r.steps}</td>
              <td>{r.error ? <span className="err">{r.error}</span> : (passed ? '' : 'mismatch')}</td>
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
      <span className="sidecar-badge up" title={sidecarReason(status) ?? undefined}>
        sidecar: {label}{status.version && ` v${status.version}`}
      </span>
    )
  }
  if (status.state === 'down') {
    return <span className="sidecar-badge down">sidecar: offline</span>
  }
  return <span className="sidecar-badge unknown">sidecar: …</span>
}

function PassBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const tone = rate >= 0.8 ? 'good' : rate >= 0.5 ? 'ok' : 'bad'
  return (
    <div className={`pass-bar tone-${tone}`}>
      <div className="pass-fill" style={{ width: `${pct}%` }} />
      <span className="pass-label">{pct}%</span>
    </div>
  )
}

function fmtExpect(t: TestCase): string {
  if (t.expect.kind === 'none') return '∅ no call'
  return `${t.expect.kind}:${t.expect.name}`
}

function fmtModal(
  called: TestResult['modalCalled'],
  test: TestCase,
): React.ReactNode {
  if (!called) return <span className="dim">—</span>
  const label = called.kind === 'none' ? '∅ no call' : `${called.kind}:${called.name}`
  const expected = test.expect
  const match = expected.kind === 'none'
    ? called.kind === 'none'
    : called.kind === expected.kind && called.name === expected.name
  return <span className={match ? 'modal-match' : 'modal-miss'}>{label}</span>
}

function fmtDelta(r: TestResult | undefined): React.ReactNode {
  if (!r) return <span className="dim">—</span>
  if (!r.stripped) return <span className="dim">—</span>
  const delta = r.passRate - r.stripped.passRate
  const cls = delta >= 0.2 ? 'delta-high' : delta > 0 ? 'delta-pos' : delta < -0.1 ? 'delta-neg' : 'delta-zero'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={cls} title={`full: ${(r.passRate * 100).toFixed(0)}%  ·  stripped: ${(r.stripped.passRate * 100).toFixed(0)}%`}>
      {sign}{(delta * 100).toFixed(0)}
    </span>
  )
}

function AblationSummary({
  tests,
  results,
}: {
  tests: TestCase[]
  results: Record<string, TestResult>
}) {
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
      <tr className="summary-row">
        <td colSpan={12}>
          <span className="summary-label">descriptions doing work</span>
          <span className="summary-metric">
            mean Δ <span className="mono">{(mean * 100).toFixed(0)}pp</span>
          </span>
          <span className="summary-metric">
            high (≥20pp) <span className="mono">{high}/{withAblation.length}</span>
          </span>
          {negative > 0 && (
            <span className="summary-metric warn">
              stripped scored higher on <span className="mono">{negative}</span> — likely misleading descriptions
            </span>
          )}
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
  initial,
  existingIds,
  targets,
  onSave,
  onCancel,
}: {
  initial: TestCase
  existingIds: Set<string>
  targets: CallTarget[]
  onSave: (t: TestCase) => void
  onCancel: () => void
}) {
  const [id, setId] = useState(initial.id)
  const [query, setQuery] = useState(initial.query)
  const [expectKind, setExpectKind] = useState<'tool' | 'skill' | 'none'>(initial.expect.kind)
  const [expectName, setExpectName] = useState(
    initial.expect.kind === 'none' ? '' : initial.expect.name,
  )
  const [notes, setNotes] = useState(initial.notes ?? '')

  const availableNames = targets
    .filter(t => t.kind === expectKind)
    .map(t => t.name)
  const nameInRegistry = availableNames.includes(expectName)

  const idError = !id.trim()
    ? 'id required'
    : existingIds.has(id.trim())
    ? 'id already used'
    : null
  const queryError = !query.trim() ? 'query required' : null
  const nameError = expectKind !== 'none' && !expectName.trim() ? 'name required' : null
  const valid = !idError && !queryError && !nameError

  return (
    <div className="test-editor-overlay" onClick={onCancel}>
      <div className="test-editor" onClick={e => e.stopPropagation()}>
        <div className="editor-title">
          {initial.query ? 'Edit test' : 'New test'}
        </div>
        <label className="ef">
          <span>id</span>
          <input value={id} onChange={e => setId(e.target.value)} />
          {idError && <em>{idError}</em>}
        </label>
        <label className="ef">
          <span>query</span>
          <textarea value={query} rows={3} onChange={e => setQuery(e.target.value)} />
          {queryError && <em>{queryError}</em>}
        </label>
        <div className="ef-row">
          <label className="ef">
            <span>expect kind</span>
            <select value={expectKind} onChange={e => setExpectKind(e.target.value as 'tool' | 'skill' | 'none')}>
              <option value="tool">tool</option>
              <option value="skill">skill</option>
              <option value="none">none (no call)</option>
            </select>
          </label>
          {expectKind !== 'none' && (
            <label className="ef">
              <span>name{!nameInRegistry && expectName ? ' ⚠︎' : ''}</span>
              <input
                list={`ef-names-${expectKind}`}
                value={expectName}
                onChange={e => setExpectName(e.target.value)}
                placeholder={availableNames[0] ?? `e.g. get_weather`}
              />
              <datalist id={`ef-names-${expectKind}`}>
                {availableNames.map(n => <option key={n} value={n} />)}
              </datalist>
              {nameError && <em>{nameError}</em>}
              {!nameError && expectName && !nameInRegistry && (
                <em className="warn">not in current registry — the model may not know about it</em>
              )}
            </label>
          )}
        </div>
        <label className="ef">
          <span>notes (optional)</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
        <div className="editor-actions">
          <button className="rescan-btn danger" onClick={onCancel}>Cancel</button>
          <button
            className="rescan-btn"
            disabled={!valid}
            onClick={() => onSave({
              id: id.trim(),
              query: query.trim(),
              expect: expectKind === 'none'
                ? { kind: 'none' }
                : { kind: expectKind, name: expectName.trim() },
              notes: notes.trim() || undefined,
            })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
