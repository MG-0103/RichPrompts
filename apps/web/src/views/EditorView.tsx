import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Eye, EyeOff } from 'lucide-react'
import type { Diagnostic, DocType, Section } from '@richprompt/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  diagnosticsToMarkers,
  MARKER_OWNER,
  offsetToRange,
  sectionsToDecorations,
} from '@/monaco/adapter'
import { installProviders } from '@/monaco/providers'
import { PreviewPane } from './PreviewPane'

const LANGUAGE_FOR: Record<DocType, string> = {
  prompt: 'markdown',
  skill: 'markdown',
  tool: 'json',
}

export interface EditorController {
  jumpTo: (d: Diagnostic) => void
}

interface Props {
  source: string
  docType: DocType
  onDocTypeChange: (d: DocType) => void
  diagnostics: Diagnostic[]
  sections: Section[]
  onChange: (next: string) => void
  theme: 'light' | 'dark'
}

const DOC_TYPES: DocType[] = ['prompt', 'tool', 'skill']

export const EditorView = forwardRef<EditorController, Props>(function EditorView(
  { source, docType, onDocTypeChange, diagnostics, sections, onChange, theme },
  ref,
) {
  const language = LANGUAGE_FOR[docType]
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('richprompt.preview.open') !== '0' } catch { return true }
  })
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('richprompt.preview.split') ?? '')
      return Number.isFinite(v) && v >= 0.15 && v <= 0.85 ? v : 0.5
    } catch { return 0.5 }
  })

  const paneRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingRef = useRef<'editor' | 'preview' | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const storeRef = useRef<{ current: Diagnostic[] }>({ current: [] })
  const providerCleanupRef = useRef<Map<string, () => void>>(new Map())
  const decoIdsRef = useRef<string[]>([])
  storeRef.current.current = diagnostics

  const togglePreview = () => {
    setPreviewOpen(v => {
      const next = !v
      try { localStorage.setItem('richprompt.preview.open', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

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
      const ratio = (e.clientX - rect.left) / rect.width
      const clamped = Math.min(0.85, Math.max(0.15, ratio))
      setSplitRatio(clamped)
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      try { localStorage.setItem('richprompt.preview.split', String(splitRatio)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [splitRatio])

  useEffect(() => {
    const ed = editorRef.current
    const mon = monacoRef.current
    if (!ed || !mon) return
    const model = ed.getModel()
    if (!model) return
    mon.editor.setModelMarkers(model, MARKER_OWNER, diagnosticsToMarkers(mon, model, diagnostics))
  }, [diagnostics])

  useEffect(() => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const next = sectionsToDecorations(model, sections)
    decoIdsRef.current = ed.deltaDecorations(decoIdsRef.current, next)
  }, [sections])

  useEffect(() => {
    const mon = monacoRef.current
    if (!mon) return
    if (!providerCleanupRef.current.has(language)) {
      providerCleanupRef.current.set(language, installProviders(mon, storeRef.current, language))
    }
  }, [language])

  useEffect(() => () => {
    for (const dispose of providerCleanupRef.current.values()) dispose()
    providerCleanupRef.current.clear()
  }, [])

  const handleMount = (ed: editor.IStandaloneCodeEditor, mon: Monaco) => {
    editorRef.current = ed
    monacoRef.current = mon
    if (!providerCleanupRef.current.has(language)) {
      providerCleanupRef.current.set(language, installProviders(mon, storeRef.current, language))
    }
    ed.onDidScrollChange(() => {
      if (syncingRef.current === 'preview') return
      const preview = previewScrollRef.current
      if (!preview) return
      const top = ed.getScrollTop()
      const max = ed.getScrollHeight() - ed.getLayoutInfo().height
      if (max <= 0) return
      const pct = top / max
      const pmax = preview.scrollHeight - preview.clientHeight
      if (pmax <= 0) return
      syncingRef.current = 'editor'
      preview.scrollTop = pct * pmax
      requestAnimationFrame(() => { syncingRef.current = null })
    })
  }

  const onPreviewScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current === 'editor') return
    const ed = editorRef.current
    if (!ed) return
    const el = e.currentTarget
    const pmax = el.scrollHeight - el.clientHeight
    if (pmax <= 0) return
    const pct = el.scrollTop / pmax
    const max = ed.getScrollHeight() - ed.getLayoutInfo().height
    if (max <= 0) return
    syncingRef.current = 'preview'
    ed.setScrollTop(pct * max)
    requestAnimationFrame(() => { syncingRef.current = null })
  }

  useImperativeHandle(ref, () => ({
    jumpTo: (d: Diagnostic) => {
      const ed = editorRef.current
      const model = ed?.getModel()
      if (!ed || !model) return
      const r = offsetToRange(model, d.range.startOffset, d.range.endOffset)
      ed.revealRangeInCenter(r)
      ed.setSelection(r)
      ed.focus()
    },
  }), [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-border px-3">
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {DOC_TYPES.map(t => (
            <button
              key={t}
              onClick={() => onDocTypeChange(t)}
              className={cn(
                'rounded-sm px-2 py-0.5 text-[11px] capitalize transition-colors',
                docType === t
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={togglePreview}
          title={previewOpen ? 'Hide preview' : 'Show preview'}
        >
          {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {previewOpen ? 'Hide preview' : 'Show preview'}
        </Button>
      </div>
      <div
        ref={paneRef}
        className="grid min-h-0 flex-1"
        style={
          previewOpen
            ? { gridTemplateColumns: `${splitRatio * 100}% 4px 1fr` }
            : { gridTemplateColumns: '1fr' }
        }
      >
        <div className="min-h-0 min-w-0">
          <Editor
            height="100%"
            language={language}
            path={`fixture.${docType}.${language === 'json' ? 'json' : 'md'}`}
            value={source}
            onChange={v => onChange(v ?? '')}
            onMount={handleMount}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 14 }}
          />
        </div>
        {previewOpen && (
          <>
            <div
              onMouseDown={startDrag}
              role="separator"
              aria-orientation="vertical"
              className="cursor-col-resize bg-border hover:bg-primary/40"
            />
            <div className="min-h-0 min-w-0">
              <PreviewPane
                ref={previewScrollRef}
                source={source}
                docType={docType}
                onScroll={onPreviewScroll}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
})
