import { useEffect, useRef, useState } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { badPrompt, type Diagnostic } from '@richprompt/core'
import { useLinter } from './hooks/useLinter'
import { diagnosticsToMarkers, MARKER_OWNER, offsetToRange } from './monaco/adapter'
import { installProviders } from './monaco/providers'
import { ProblemsPanel } from './components/ProblemsPanel'
import './App.css'

const LANGUAGE_ID = 'markdown'

function App() {
  const [source, setSource] = useState(badPrompt)
  const diagnostics = useLinter(source, 'prompt')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const storeRef = useRef<{ current: Diagnostic[] }>({ current: [] })

  storeRef.current.current = diagnostics

  useEffect(() => {
    const ed = editorRef.current
    const mon = monacoRef.current
    if (!ed || !mon) return
    const model = ed.getModel()
    if (!model) return
    mon.editor.setModelMarkers(model, MARKER_OWNER, diagnosticsToMarkers(mon, model, diagnostics))
  }, [diagnostics])

  const handleMount = (ed: editor.IStandaloneCodeEditor, mon: Monaco) => {
    editorRef.current = ed
    monacoRef.current = mon
    installProviders(mon, storeRef.current, LANGUAGE_ID)
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>RichPrompt</h1>
        <span className="doc-type">prompt</span>
      </header>
      <div className="editor-pane">
        <Editor
          height="100%"
          defaultLanguage={LANGUAGE_ID}
          value={source}
          onChange={v => setSource(v ?? '')}
          onMount={handleMount}
          options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 14 }}
        />
      </div>
      <ProblemsPanel diagnostics={diagnostics} onJump={jumpTo} />
    </div>
  )
}

export default App
