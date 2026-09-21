import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { RIGHT_PANE_VIEWS, type RightPaneView } from '@/shell/views'

interface Props {
  editor: ReactNode
  rightPane: RightPaneView
  onRightPaneChange: (v: RightPaneView) => void
  rightContent: ReactNode
  /** Optional counts badged next to each tab. */
  badges?: Partial<Record<RightPaneView, number>>
}

export function Workbench({ editor, rightPane, onRightPaneChange, rightContent, badges }: Props) {
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('richprompt.wb.split') ?? '')
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
      try { localStorage.setItem('richprompt.wb.split', String(ratio)) } catch { /* ignore */ }
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
      <div className="min-h-0 min-w-0">{editor}</div>
      <div
        onMouseDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        className="cursor-col-resize bg-border hover:bg-primary/40"
      />
      <div className="flex min-h-0 min-w-0 flex-col border-l border-border">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          {RIGHT_PANE_VIEWS.map(v => {
            const count = badges?.[v.key]
            return (
              <button
                key={v.key}
                onClick={() => onRightPaneChange(v.key)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
                  rightPane === v.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {v.label}
                {typeof count === 'number' && count > 0 && (
                  <span
                    className={cn(
                      'rounded px-1 text-[10px] font-mono',
                      rightPane === v.key ? 'bg-primary/20' : 'bg-muted',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{rightContent}</div>
      </div>
    </div>
  )
}
