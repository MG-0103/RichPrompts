import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { TestsPanel } from './components/TestsPanel'
import { useRegistry } from './hooks/useRegistry'
import { useScore } from './hooks/useScore'
import { useLLMReview } from './hooks/useLLMReview'
import { useTests } from './hooks/useTests'
import { loadConfig, resetConfig, saveConfig } from './persistence/config'
import { sampleRegistryTools, sampleRegistrySkills } from '@richprompt/core'
import type { RuleConfig } from '@richprompt/core'
import './App.css'

type BottomTab = 'problems' | 'registry' | 'review' | 'tests' | 'settings'

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
  const tests = useTests()
  const [bottomTab, setBottomTab] = useState<BottomTab>('problems')
  const [useMock, setUseMock] = useState<boolean>(() => {
    try { return localStorage.getItem('richprompt.tests.mock') !== '0' } catch { return true }
  })
  const toggleMock = (v: boolean) => {
    setUseMock(v)
    try { localStorage.setItem('richprompt.tests.mock', v ? '1' : '0') } catch { /* ignore */ }
  }
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

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.classList.add('splitter-dragging')
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
      document.body.classList.remove('splitter-dragging')
      try { localStorage.setItem('richprompt.preview.split', String(splitRatio)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [splitRatio])

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
      <div
        ref={paneRef}
        className={`editor-pane ${previewOpen ? 'split' : ''}`}
        style={previewOpen ? {
          gridTemplateColumns: `${splitRatio * 100}% 4px 1fr`,
        } : undefined}
      >
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
          <>
            <div
              className="splitter"
              onMouseDown={startDrag}
              role="separator"
              aria-orientation="vertical"
            />
            <div className="preview-col">
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
            className={`btab ${bottomTab === 'tests' ? 'active' : ''}`}
            onClick={() => setBottomTab('tests')}
          >
            Tests <span className="btab-count">{tests.tests.length}</span>
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
          {bottomTab === 'tests' && (
            <TestsPanel
              tests={tests.tests}
              results={tests.results}
              loading={tests.loading}
              error={tests.error}
              sidecar={tests.sidecar}
              useMock={useMock}
              onToggleMock={toggleMock}
              onRunAll={() => tests.run({
                prompt: sources.prompt,
                tools: sampleRegistryTools,
                skills: sampleRegistrySkills,
                config: { mock: useMock },
              })}
              onRunOne={id => tests.run({
                prompt: sources.prompt,
                tools: sampleRegistryTools,
                skills: sampleRegistrySkills,
                onlyIds: [id],
                config: { mock: useMock },
              })}
              onCancel={tests.cancel}
              onUpsert={tests.upsert}
              onRemove={tests.remove}
              onReset={tests.reset}
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
