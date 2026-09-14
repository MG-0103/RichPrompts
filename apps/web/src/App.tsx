import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import {
  badPrompt,
  badTool,
  badSkill,
  type Diagnostic,
  type DocType,
} from '@richprompt/core'
import { useLinter } from './hooks/useLinter'
import { diagnosticsToMarkers, MARKER_OWNER, offsetToRange } from './monaco/adapter'
import { installProviders } from './monaco/providers'
import { ProblemsPanel } from './components/ProblemsPanel'
import './App.css'

const FIXTURES: Record<DocType, string> = {
  prompt: badPrompt,
  tool: badTool,
  skill: badSkill,
}

const LANGUAGE_FOR: Record<DocType, string> = {
  prompt: 'markdown',
  skill: 'markdown',
  tool: 'json',
}

function App() {
  const [docType, setDocType] = useState<DocType>('prompt')
  const [sources, setSources] = useState<Record<DocType, string>>(FIXTURES)
  const source = sources[docType]
  const language = LANGUAGE_FOR[docType]
  const diagnostics = useLinter(source, docType)

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const storeRef = useRef<{ current: Diagnostic[] }>({ current: [] })
  const providerCleanupRef = useRef<Map<string, () => void>>(new Map())
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

  const jumpTo = (d: Diagnostic) => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const r = offsetToRange(model, d.range.startOffset, d.range.endOffset)
    ed.revealRangeInCenter(r)
    ed.setSelection(r)
    ed.focus()
  }

  const tabs = useMemo(() => (['prompt', 'tool', 'skill'] as DocType[]), [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>RichPrompt</h1>
        <div className="tabs">
          {tabs.map(t => (
            <button
              key={t}
              className={t === docType ? 'tab active' : 'tab'}
              onClick={() => setDocType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </header>
      <div className="editor-pane">
        <Editor
          height="100%"
          language={language}
          path={`fixture.${docType}.${language === 'json' ? 'json' : 'md'}`}
          value={source}
          onChange={v => setSources(s => ({ ...s, [docType]: v ?? '' }))}
          onMount={handleMount}
          options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 14 }}
        />
      </div>
      <ProblemsPanel diagnostics={diagnostics} onJump={jumpTo} />
    </div>
  )
}

export default App
