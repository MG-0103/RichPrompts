import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { Diagnostic, DocType, Section } from '@richprompt/core'
import { cn } from '@/lib/utils'
import {
  diagnosticsToMarkers,
  highlightsToDecorations,
  MARKER_OWNER,
  offsetToRange,
  sectionsToDecorations,
  type HighlightRange,
} from '@/monaco/adapter'
import { installProviders } from '@/monaco/providers'

const LANGUAGE_FOR: Record<DocType, string> = {
  prompt: 'markdown',
  skill: 'markdown',
  tool: 'json',
}

const DOC_TYPES: DocType[] = ['prompt', 'tool', 'skill']

export interface EditorController {
  jumpTo: (d: Diagnostic) => void
  getScrollPct: () => number
  setScrollPct: (pct: number) => void
  onScroll: (cb: () => void) => () => void
}

interface Props {
  source: string
  docType: DocType
  onDocTypeChange: (d: DocType) => void
  diagnostics: Diagnostic[]
  sections: Section[]
  onChange: (next: string) => void
  theme: 'light' | 'dark'
  /** Extra items rendered to the right of the doc-type switcher in the toolbar. */
  toolbarExtras?: React.ReactNode
  /** Contextual highlight ranges — used to mark cluster members while
   *  the Merge view is open. Painted on top of the canonical-section
   *  bars, never replaces them. */
  highlightRanges?: HighlightRange[]
}

export const EditorPane = forwardRef<EditorController, Props>(function EditorPane(
  { source, docType, onDocTypeChange, diagnostics, sections, onChange, theme, toolbarExtras, highlightRanges },
  ref,
) {
  const language = LANGUAGE_FOR[docType]
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const storeRef = useRef<{ current: Diagnostic[] }>({ current: [] })
  const providerCleanupRef = useRef<Map<string, () => void>>(new Map())
  const decoIdsRef = useRef<string[]>([])
  const highlightIdsRef = useRef<string[]>([])
  storeRef.current.current = diagnostics

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
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const next = highlightRanges
      ? highlightsToDecorations(model, highlightRanges)
      : []
    highlightIdsRef.current = ed.deltaDecorations(highlightIdsRef.current, next)
    // On first highlight, scroll the earliest range into view.
    if (highlightRanges && highlightRanges.length > 0) {
      const first = highlightRanges.reduce(
        (a, b) => (b.startOffset < a.startOffset ? b : a),
        highlightRanges[0],
      )
      const pos = model.getPositionAt(first.startOffset)
      ed.revealLineInCenter(pos.lineNumber)
    }
  }, [highlightRanges])

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
    getScrollPct: () => {
      const ed = editorRef.current
      if (!ed) return 0
      const max = ed.getScrollHeight() - ed.getLayoutInfo().height
      if (max <= 0) return 0
      return ed.getScrollTop() / max
    },
    setScrollPct: (pct: number) => {
      const ed = editorRef.current
      if (!ed) return
      const max = ed.getScrollHeight() - ed.getLayoutInfo().height
      if (max <= 0) return
      ed.setScrollTop(pct * max)
    },
    onScroll: (cb: () => void) => {
      const ed = editorRef.current
      if (!ed) return () => {}
      const d = ed.onDidScrollChange(cb)
      return () => d.dispose()
    },
  }), [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
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
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">editor</span>
        {toolbarExtras && <div className="ml-auto">{toolbarExtras}</div>}
      </div>
      <div className="min-h-0 flex-1">
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
    </div>
  )
})
