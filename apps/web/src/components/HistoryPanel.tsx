import { useEffect, useMemo, useState } from 'react'
import type { DocType, Version } from '@richprompt/core'

type Props = {
  docType: DocType
  currentContent: string
  versions: Version[]
  onCommit: (label: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onRestore: (content: string) => void
}

export function HistoryPanel({
  docType,
  currentContent,
  versions,
  onCommit,
  onRename,
  onDelete,
  onRestore,
}: Props) {
  const commits = useMemo(
    () => versions.filter(v => v.kind === 'commit').slice().reverse(),
    [versions],
  )
  const autos = useMemo(
    () => versions.filter(v => v.kind === 'auto').slice().reverse(),
    [versions],
  )
  const [showAutos, setShowAutos] = useState(false)
  const [selected, setSelected] = useState<[string | null, string | null]>([null, null])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameLabel, setRenameLabel] = useState('')
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitLabel, setCommitLabel] = useState('')

  const byId: Record<string, Version> = useMemo(() => {
    const m: Record<string, Version> = {}
    for (const v of versions) m[v.id] = v
    return m
  }, [versions])

  const [leftId, rightId] = selected
  const leftContent = leftId ? byId[leftId]?.content : null
  const rightContent = rightId ? byId[rightId]?.content : currentContent

  const showDiff = leftId && (rightId || leftContent !== null)
  const [diffText, setDiffText] = useState<string>('')

  useEffect(() => {
    if (!showDiff || leftContent == null || rightContent == null) {
      setDiffText('')
      return
    }
    let cancelled = false
    ;(async () => {
      // Lazy-load jsdiff so it stays out of the main bundle.
      const { createTwoFilesPatch } = await import('diff')
      const leftName = leftId ? labelOf(byId[leftId]) : 'older'
      const rightName = rightId ? labelOf(byId[rightId]) : 'current'
      const patch = createTwoFilesPatch(
        leftName, rightName, leftContent, rightContent, '', '',
        { context: 3 },
      )
      if (!cancelled) setDiffText(patch)
    })()
    return () => { cancelled = true }
  }, [showDiff, leftId, rightId, leftContent, rightContent, byId])

  const toggleSelect = (id: string) => {
    setSelected(([a, b]) => {
      if (a === id) return [b, null]
      if (b === id) return [a, null]
      if (a && b) return [b, id]
      if (a) return [a, id]
      return [id, null]
    })
  }

  const doCommit = () => {
    if (!commitLabel.trim()) return
    onCommit(commitLabel.trim())
    setCommitLabel('')
    setCommitOpen(false)
  }

  return (
    <div className="history-panel">
      <div className="history-header">
        <span>History · {docType}</span>
        <div className="history-actions">
          <button className="rescan-btn" onClick={() => setCommitOpen(true)}>
            + Commit version
          </button>
        </div>
      </div>

      {commitOpen && (
        <div className="commit-strip">
          <input
            autoFocus
            value={commitLabel}
            placeholder="Label this version (e.g. 'v1 shipped')"
            onChange={e => setCommitLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') doCommit()
              if (e.key === 'Escape') setCommitOpen(false)
            }}
          />
          <button className="rescan-btn" disabled={!commitLabel.trim()} onClick={doCommit}>
            Save
          </button>
          <button className="link-btn" onClick={() => setCommitOpen(false)}>cancel</button>
        </div>
      )}

      <div className="history-hint">
        Click a version to diff it against current. Click a second to diff two versions.
      </div>

      <VersionList
        title="Commits"
        emptyText="No commits yet. Cmd+S or ‘+ Commit version’ to save one."
        items={commits}
        selected={selected}
        renaming={renaming}
        renameLabel={renameLabel}
        onToggle={toggleSelect}
        onRestore={id => onRestore(byId[id].content)}
        onStartRename={id => { setRenaming(id); setRenameLabel(byId[id].label ?? '') }}
        onRenameChange={setRenameLabel}
        onRenameCommit={id => { onRename(id, renameLabel.trim()); setRenaming(null) }}
        onCancelRename={() => setRenaming(null)}
        onDelete={id => { if (window.confirm('Delete this commit?')) onDelete(id) }}
      />

      <div className="autos-header" onClick={() => setShowAutos(v => !v)}>
        <span className={`chev ${showAutos ? 'open' : ''}`}>▸</span>
        Auto-saves ({autos.length})
      </div>
      {showAutos && (
        <VersionList
          items={autos}
          selected={selected}
          renaming={null}
          renameLabel=""
          emptyText="No auto-saves yet."
          onToggle={toggleSelect}
          onRestore={id => onRestore(byId[id].content)}
          onStartRename={() => {}}
          onRenameChange={() => {}}
          onRenameCommit={() => {}}
          onCancelRename={() => {}}
          onDelete={id => onDelete(id)}
          compact
        />
      )}

      {showDiff && (
        <div className="diff-view">
          <div className="diff-title">
            {leftId ? labelOf(byId[leftId]) : ''}
            <span className="diff-vs">vs.</span>
            {rightId ? labelOf(byId[rightId]) : 'current'}
            <button className="link-btn" onClick={() => setSelected([null, null])}>close</button>
          </div>
          <pre className="diff-body">{renderDiff(diffText)}</pre>
        </div>
      )}
    </div>
  )
}

function VersionList({
  title,
  emptyText,
  items,
  selected,
  renaming,
  renameLabel,
  onToggle,
  onRestore,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onCancelRename,
  onDelete,
  compact,
}: {
  title?: string
  emptyText: string
  items: Version[]
  selected: [string | null, string | null]
  renaming: string | null
  renameLabel: string
  onToggle: (id: string) => void
  onRestore: (id: string) => void
  onStartRename: (id: string) => void
  onRenameChange: (v: string) => void
  onRenameCommit: (id: string) => void
  onCancelRename: () => void
  onDelete: (id: string) => void
  compact?: boolean
}) {
  return (
    <div className={`version-list ${compact ? 'compact' : ''}`}>
      {title && <div className="version-list-title">{title}</div>}
      {items.length === 0 && <div className="version-empty">{emptyText}</div>}
      <ul>
        {items.map(v => {
          const sel = selected[0] === v.id ? 'sel-a' : selected[1] === v.id ? 'sel-b' : ''
          return (
            <li key={v.id} className={`version-row ${sel}`}>
              <button className="version-select" onClick={() => onToggle(v.id)}>
                <span className="version-when">{fmtWhen(v.timestamp)}</span>
                {renaming === v.id ? (
                  <input
                    autoFocus
                    className="rename-input"
                    value={renameLabel}
                    onClick={e => e.stopPropagation()}
                    onChange={e => onRenameChange(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') onRenameCommit(v.id)
                      if (e.key === 'Escape') onCancelRename()
                    }}
                  />
                ) : (
                  <span className="version-label">
                    {v.kind === 'commit' ? (v.label ?? 'untitled') : `auto · ${abbrevHash(v.contentHash)}`}
                  </span>
                )}
              </button>
              <div className="version-actions" onClick={e => e.stopPropagation()}>
                {v.kind === 'commit' && (
                  <button className="link-btn" onClick={() => onStartRename(v.id)}>rename</button>
                )}
                <button className="link-btn" onClick={() => onRestore(v.id)}>restore</button>
                <button className="link-btn danger" onClick={() => onDelete(v.id)}>del</button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function renderDiff(patch: string) {
  // Strip the noisy header lines from createTwoFilesPatch (--- +++ @@)
  // and color the remaining +/- lines.
  const lines = patch.split('\n')
  return lines.map((line, i) => {
    if (i < 4) return null // "Index:", "===", "---", "+++"
    let cls = 'dl'
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'dl add'
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'dl del'
    else if (line.startsWith('@@')) cls = 'dl hunk'
    return <span key={i} className={cls}>{line}{'\n'}</span>
  })
}

function labelOf(v: Version | undefined): string {
  if (!v) return '?'
  if (v.kind === 'commit') return v.label ?? 'untitled'
  return `auto ${fmtWhen(v.timestamp)}`
}

function abbrevHash(h: number): string {
  return h.toString(16).slice(0, 6)
}

function fmtWhen(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const dayMs = 24 * 3600 * 1000
  if (now - ts < dayMs) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
