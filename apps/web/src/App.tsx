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
import { RegistryPanel } from './components/RegistryPanel'
import { ScoreBadge } from './components/ScoreBadge'
import { LLMReviewPanel } from './components/LLMReviewPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { PreviewPane } from './components/PreviewPane'
import { useRegistry } from './hooks/useRegistry'
import { useScore } from './hooks/useScore'
import { useLLMReview } from './hooks/useLLMReview'
import { loadConfig, resetConfig, saveConfig } from './persistence/config'
import type { RuleConfig } from '@richprompt/core'
import './App.css'

type BottomTab = 'problems' | 'registry' | 'review' | 'settings'

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
  const [config, setConfigState] = useState<RuleConfig>(() => loadConfig())
  const updateConfig = (cfg: RuleConfig) => { setConfigState(cfg); saveConfig(cfg) }
  const resetConfigToDefault = () => { resetConfig(); setConfigState(loadConfig()) }
  const diagnostics = useLinter(source, docType, config)
  const { breakdown, history } = useScore(source, docType, diagnostics)
  const { findings: registryFindings, rescan } = useRegistry()
  const llm = useLLMReview()
  const [bottomTab, setBottomTab] = useState<BottomTab>('problems')
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('richprompt.preview.open') !== '0' } catch { return true }
  })
  const togglePreview = () => {
    setPreviewOpen(v => {
      const next = !v
      try { localStorage.setItem('richprompt.preview.open', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

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
        <ScoreBadge breakdown={breakdown} history={history} />
        <button
          className="preview-toggle"
          onClick={togglePreview}
          title={previewOpen ? 'Hide preview' : 'Show preview'}
        >
          {previewOpen ? 'Hide preview' : 'Show preview'}
        </button>
      </header>
      <div className={`editor-pane ${previewOpen ? 'split' : ''}`}>
        <div className="editor-col">
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
        {previewOpen && (
          <div className="preview-col">
            <PreviewPane source={source} docType={docType} />
          </div>
        )}
      </div>
      <div className="bottom">
        <div className="bottom-tabs">
          <button
            className={`btab ${bottomTab === 'problems' ? 'active' : ''}`}
            onClick={() => setBottomTab('problems')}
          >
            Problems <span className="btab-count">{diagnostics.length}</span>
          </button>
          <button
            className={`btab ${bottomTab === 'registry' ? 'active' : ''}`}
            onClick={() => setBottomTab('registry')}
          >
            Registry <span className="btab-count">{registryFindings.length}</span>
          </button>
          <button
            className={`btab tier3 ${bottomTab === 'review' ? 'active' : ''}`}
            onClick={() => setBottomTab('review')}
          >
            LLM Review
          </button>
          <button
            className={`btab ${bottomTab === 'settings' ? 'active' : ''}`}
            onClick={() => setBottomTab('settings')}
          >
            Settings
          </button>
        </div>
        <div className="bottom-body">
          {bottomTab === 'problems' && (
            <ProblemsPanel diagnostics={diagnostics} onJump={jumpTo} />
          )}
          {bottomTab === 'registry' && (
            <RegistryPanel findings={registryFindings} onRescan={rescan} />
          )}
          {bottomTab === 'review' && (
            <LLMReviewPanel
              apiKey={llm.apiKey}
              setApiKey={llm.setApiKey}
              loading={llm.loading}
              output={llm.output}
              error={llm.error}
              onReview={() => llm.review(docType, source, diagnostics)}
            />
          )}
          {bottomTab === 'settings' && (
            <SettingsPanel
              config={config}
              onChange={updateConfig}
              onReset={resetConfigToDefault}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
