import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, X, Plus } from 'lucide-react'
import type { DocType, Version } from '@richprompt/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Props = {
  docType: DocType
  currentContent: string
  versions: Version[]
  onCommit: (label: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onRestore: (content: string) => void
}

export function HistoryView({
  docType,
  currentContent,
  versions,
  onCommit,
  onRename,
  onDelete,
  onRestore,
}: Props) {
  const commits = useMemo(() => versions.filter(v => v.kind === 'commit').slice().reverse(), [versions])
  const autos = useMemo(() => versions.filter(v => v.kind === 'auto').slice().reverse(), [versions])
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
      const { createTwoFilesPatch } = await import('diff')
      const leftName = leftId ? labelOf(byId[leftId]) : 'older'
      const rightName = rightId ? labelOf(byId[rightId]) : 'current'
      const patch = createTwoFilesPatch(leftName, rightName, leftContent, rightContent, '', '', { context: 3 })
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
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            <span>History</span>
            <Badge variant="outline" className="text-[10px]">{docType}</Badge>
            <div className="ml-auto">
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setCommitOpen(true)}>
                <Plus className="h-3 w-3" /> Commit version
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {commitOpen && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
              <Input
                autoFocus
                value={commitLabel}
                placeholder="Label this version (e.g. 'v1 shipped')"
                onChange={e => setCommitLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') doCommit()
                  if (e.key === 'Escape') setCommitOpen(false)
                }}
                className="h-8"
              />
              <Button size="sm" disabled={!commitLabel.trim()} onClick={doCommit}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setCommitOpen(false)}>Cancel</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Click a version to diff it against current. Click a second to diff two versions.
          </p>

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

          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAutos(v => !v)}
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', showAutos && 'rotate-90')} />
            Auto-saves ({autos.length})
          </button>
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
        </CardContent>
      </Card>

      {showDiff && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <span>{leftId ? labelOf(byId[leftId]) : ''}</span>
              <span className="text-muted-foreground">vs.</span>
              <span>{rightId ? labelOf(byId[rightId]) : 'current'}</span>
              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => setSelected([null, null])}>
                <X className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-xs">
              {renderDiff(diffText)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function VersionList({
  title, emptyText, items, selected, renaming, renameLabel,
  onToggle, onRestore, onStartRename, onRenameChange, onRenameCommit, onCancelRename, onDelete, compact,
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
    <div className={cn(compact && 'ml-4')}>
      {title && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>}
      {items.length === 0 && <div className="py-2 text-sm text-muted-foreground">{emptyText}</div>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map(v => {
          const isA = selected[0] === v.id
          const isB = selected[1] === v.id
          return (
            <li
              key={v.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-xs',
                (isA || isB) && 'bg-primary/10',
              )}
            >
              <button
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => onToggle(v.id)}
              >
                {(isA || isB) && (
                  <Badge variant="outline" className="h-4 border-primary/40 px-1 text-[9px] text-primary">
                    {isA ? 'A' : 'B'}
                  </Badge>
                )}
                <span className="font-mono text-muted-foreground">{fmtWhen(v.timestamp)}</span>
                {renaming === v.id ? (
                  <Input
                    autoFocus
                    value={renameLabel}
                    className="h-6 text-xs"
                    onClick={e => e.stopPropagation()}
                    onChange={e => onRenameChange(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') onRenameCommit(v.id)
                      if (e.key === 'Escape') onCancelRename()
                    }}
                  />
                ) : (
                  <span className="truncate">
                    {v.kind === 'commit' ? (v.label ?? 'untitled') : `auto · ${abbrevHash(v.contentHash)}`}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                {v.kind === 'commit' && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onStartRename(v.id)}>rename</Button>
                )}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onRestore(v.id)}>restore</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => onDelete(v.id)}>del</Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function renderDiff(patch: string) {
  const lines = patch.split('\n')
  return lines.map((line, i) => {
    if (i < 4) return null
    let cls = 'text-foreground/80'
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-emerald-500'
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-500'
    else if (line.startsWith('@@')) cls = 'text-sky-500 font-semibold'
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
