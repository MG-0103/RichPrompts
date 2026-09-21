import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActiveMerge } from '@/hooks/useClusterMerge'
import { MergeDiffPanel, MergeSuggestionPanel } from './MergeView'

interface Props {
  active: ActiveMerge
  available: boolean
  reason: string | null
  onEdit: (next: string) => void
  onRegenerate: () => void
  onApply: () => void
  onCancel: () => void
}

const SPLIT_KEY = 'richprompt.merge.split'

/**
 * Full-workbench takeover for the cluster-merge flow. Left column:
 * the diff (originals + shared-span highlights). Right column: the
 * LLM's proposed merge. Same splitter pattern the workbench uses so
 * the layout is muscle-memory.
 */
export function MergeWorkbench(props: Props) {
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem(SPLIT_KEY) ?? '')
      return Number.isFinite(v) && v >= 0.2 && v <= 0.8 ? v : 0.5
    } catch { return 0.5 }
  })
  const paneRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const pane = paneRef.current
      if (!pane) return
      const rect = pane.getBoundingClientRect()
      const r = (e.clientX - rect.left) / rect.width
      setRatio(Math.min(0.8, Math.max(0.2, r)))
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      try { localStorage.setItem(SPLIT_KEY, String(ratio)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [ratio])

  return (
    <div
      ref={paneRef}
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `${ratio * 100}% 4px 1fr` }}
    >
      <div className="min-h-0 min-w-0 border-r border-border">
        <MergeDiffPanel active={props.active} />
      </div>
      <div
        onMouseDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        className="cursor-col-resize bg-border hover:bg-primary/40"
      />
      <div className="min-h-0 min-w-0">
        <MergeSuggestionPanel {...props} />
      </div>
    </div>
  )
}
