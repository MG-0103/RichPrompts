import { useState } from 'react'
import type { TestCase, TestResult } from '@richprompt/core'
import type { SidecarStatus } from '../hooks/useTests'

type Props = {
  tests: TestCase[]
  results: Record<string, TestResult>
  loading: boolean
  error: string | null
  sidecar: SidecarStatus
  useMock: boolean
  onToggleMock: (v: boolean) => void
  onRunAll: () => void
  onRunOne: (id: string) => void
  onCancel: () => void
  onUpsert: (tc: TestCase) => void
  onRemove: (id: string) => void
  onReset: () => void
}

export function TestsPanel({
  tests, results, loading, error, sidecar, useMock, onToggleMock,
  onRunAll, onRunOne, onCancel, onUpsert, onRemove, onReset,
}: Props) {
  const realReady = sidecar.state === 'up' && sidecar.real?.available === true
  const [editing, setEditing] = useState<TestCase | null>(null)

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
        <div className="tests-actions">
          <button className="rescan-btn" onClick={() => setEditing(BLANK_TEST())}>+ Add</button>
          <button className="rescan-btn" onClick={onReset} title="Restore seed tests">Reset</button>
          {loading ? (
            <button className="rescan-btn danger" onClick={onCancel}>Cancel</button>
          ) : (
            <button className="rescan-btn" onClick={onRunAll}>Run all</button>
          )}
        </div>
      </div>

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
            <th>id</th>
            <th>query</th>
            <th>expect</th>
            <th>pass</th>
            <th>logp</th>
            <th>steps</th>
            <th>score</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tests.map(t => {
            const r = results[t.id]
            return (
              <tr key={t.id}>
                <td className="t-id">{t.id}</td>
                <td className="t-q">{t.query}</td>
                <td className="t-exp">{fmtExpect(t)}</td>
                <td>{r ? <PassBar rate={r.passRate} /> : <span className="dim">—</span>}</td>
                <td className="mono">{r?.meanLogprob != null ? r.meanLogprob.toFixed(2) : <span className="dim">—</span>}</td>
                <td className="mono">{r ? r.meanSteps.toFixed(1) : <span className="dim">—</span>}</td>
                <td className="mono">{r ? (r.routingScore * 100).toFixed(0) : <span className="dim">—</span>}</td>
                <td className="t-actions">
                  <button className="link-btn" onClick={() => onRunOne(t.id)}>run</button>
                  <button className="link-btn" onClick={() => setEditing({ ...t })}>edit</button>
                  <button className="link-btn danger" onClick={() => onRemove(t.id)}>del</button>
                </td>
              </tr>
            )
          })}
          {tests.length === 0 && (
            <tr><td colSpan={8} className="tests-empty">No tests yet. Click "+ Add" to create one.</td></tr>
          )}
        </tbody>
      </table>

      {editing && (
        <TestEditor
          initial={editing}
          existingIds={new Set(tests.map(t => t.id).filter(id => id !== editing.id))}
          onSave={tc => { onUpsert(tc); setEditing(null) }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
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
  onSave,
  onCancel,
}: {
  initial: TestCase
  existingIds: Set<string>
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
          {initial.query || initial.expect.kind !== 'tool' || initial.expect.name ? 'Edit test' : 'New test'}
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
              <span>name</span>
              <input value={expectName} onChange={e => setExpectName(e.target.value)} placeholder="e.g. get_weather" />
              {nameError && <em>{nameError}</em>}
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
