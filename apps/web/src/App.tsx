import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNoiseFix,
  badPrompt,
  badTool,
  badSkill,
  hashContent,
  parseDocument,
  sampleRegistryTools,
  sampleRegistrySkills,
  type CanonicalSection,
  type Diagnostic,
  type DocType,
  type NoiseFlag,
  type Section,
} from '@richprompt/core'
import { useLinter } from './hooks/useLinter'
import { useStructure } from './hooks/useStructure'
import { useSemanticDuplication } from './hooks/useSemanticDuplication'
import { useSectionClassifier } from './hooks/useSectionClassifier'
import { useLLMReview } from './hooks/useLLMReview'
import { useRegistry } from './hooks/useRegistry'
import { useTests } from './hooks/useTests'
import { useVersioning } from './hooks/useVersioning'
import { loadConfig, resetConfig, saveConfig } from './persistence/config'
import { loadTestingConfig, saveTestingConfig } from './persistence/testConfig'
import { clearDismissals, loadDismissals, toggleDismissal } from './persistence/dismissals'
import { addPin, loadPins, removePin, type RegistryPin } from './persistence/pins'
import { callTargets } from './testing/registry'
import type { RuleConfig } from '@richprompt/core'
import { TooltipProvider } from './components/ui/tooltip'
import { AppShell } from './shell/AppShell'
import { useNavigation } from './shell/useNavigation'
import { useTheme } from './shell/useTheme'
import { rightPaneLabel, workspaceLabel } from './shell/views'
import type { Crumb } from './shell/Breadcrumbs'
import type { EditorController } from './views/EditorPane'
import { Placeholder } from './views/Placeholder'
import { Loader2 } from 'lucide-react'

// Heavy views load on demand: PreviewPane pulls react-markdown +
// rehype-highlight (~2 MB of syntax grammars); StructureView pulls the
// duplication + budget UI; TestsView pulls the results table; etc.
const PreviewPane = lazy(() =>
  import('./views/PreviewPane').then(m => ({ default: m.PreviewPane })),
)
const StructureView = lazy(() =>
  import('./views/StructureView').then(m => ({ default: m.StructureView })),
)
const HistoryView = lazy(() =>
  import('./views/HistoryView').then(m => ({ default: m.HistoryView })),
)
const LLMReviewView = lazy(() =>
  import('./views/LLMReviewView').then(m => ({ default: m.LLMReviewView })),
)
const TestsView = lazy(() =>
  import('./views/TestsView').then(m => ({ default: m.TestsView })),
)
const RegistryView = lazy(() =>
  import('./views/RegistryView').then(m => ({ default: m.RegistryView })),
)
const SettingsView = lazy(() =>
  import('./views/SettingsView').then(m => ({ default: m.SettingsView })),
)
// Bundles Monaco + Editor + Workbench into one lazy chunk.
const WorkbenchBundle = lazy(() =>
  import('./views/WorkbenchBundle').then(m => ({ default: m.WorkbenchBundle })),
)

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}

const FIXTURES: Record<DocType, string> = {
  prompt: badPrompt,
  tool: badTool,
  skill: badSkill,
}

const DOC_LABEL: Record<DocType, string> = {
  prompt: 'Prompt',
  tool: 'Tool',
  skill: 'Skill',
}

function App() {
  const nav = useNavigation()
  const { theme, toggleTheme } = useTheme()
  const [sources, setSources] = useState<Record<DocType, string>>(FIXTURES)
  const [config, setConfigState] = useState<RuleConfig>(() => loadConfig())
  const updateConfig = (cfg: RuleConfig) => { setConfigState(cfg); saveConfig(cfg) }
  const resetConfigToDefault = () => { resetConfig(); setConfigState(loadConfig()) }
  const source = sources[nav.docType]
  const rawDiagnostics = useLinter(source, nav.docType, config)
  const sections: Section[] = useMemo(
    () => (nav.docType === 'tool' ? [] : parseDocument(source, nav.docType).sections),
    [source, nav.docType],
  )
  const editorRef = useRef<EditorController | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingRef = useRef<'editor' | 'preview' | null>(null)
  const [hoveredDiag, setHoveredDiag] = useState<Diagnostic | null>(null)
  const hoverRange = hoveredDiag
    ? { start: hoveredDiag.range.startOffset, end: hoveredDiag.range.endOffset }
    : null

  // Structure + semantic duplication
  const [runnerConfig, setRunnerConfig] = useState(() => loadTestingConfig())
  const updateRunnerConfig = (c: typeof runnerConfig) => {
    setRunnerConfig(c)
    saveTestingConfig(c)
  }
  const [useMock, setUseMock] = useState<boolean>(() => {
    try { return localStorage.getItem('richprompt.tests.mock') !== '0' } catch { return true }
  })
  const toggleMock = (v: boolean) => {
    setUseMock(v)
    try { localStorage.setItem('richprompt.tests.mock', v ? '1' : '0') } catch { /* ignore */ }
  }
  const structure = useStructure(source, nav.docType, runnerConfig.model)
  const structureReport = structure.report
  const structureHash = useMemo(
    () => `${nav.docType}:${hashContent(source)}`,
    [nav.docType, source],
  )
  const sectionClassifier = useSectionClassifier(source, structureHash)

  /**
   * If the AI classifier has run and reports a section as present,
   * strip that name from the `prompt/missing-sections` diagnostic (and
   * drop the diagnostic entirely when the classifier accounts for
   * every listed name). Every other diagnostic passes through as-is.
   */
  const diagnostics = useMemo(() => {
    if (!sectionClassifier.found) return rawDiagnostics
    const hinted = new Set<CanonicalSection>(sectionClassifier.found)
    return rawDiagnostics.flatMap(d => {
      if (d.ruleId !== 'prompt/missing-sections') return [d]
      const m = d.message.match(/Missing recommended sections: ([^.]+)\./)
      if (!m) return [d]
      const listed = m[1].split(',').map(s => s.trim()) as CanonicalSection[]
      const remaining = listed.filter(s => !hinted.has(s))
      if (remaining.length === 0) return []
      return [{
        ...d,
        message: `Missing recommended sections: ${remaining.join(', ')}. Add headings or <${remaining[0]}> tags.`,
      }]
    })
  }, [rawDiagnostics, sectionClassifier.found])
  const tests = useTests()
  const llm = useLLMReview()
  const registry = useRegistry()
  const verifierReady =
    tests.sidecar.state === 'up' ? Boolean(tests.sidecar.verifier?.available) : false
  const openaiReady =
    tests.sidecar.state === 'up' ? Boolean(tests.sidecar.openai?.available) : false
  const openaiReason =
    tests.sidecar.state === 'up' ? tests.sidecar.openai?.reason ?? null : 'sidecar offline'
  const registryNames = useMemo(() => {
    const targetsInline = callTargets(sampleRegistryTools, sampleRegistrySkills)
    return {
      toolNames: targetsInline.filter(t => t.kind === 'tool').map(t => t.name),
      skillNames: targetsInline.filter(t => t.kind === 'skill').map(t => t.name),
    }
  }, [])
  const semantic = useSemanticDuplication(
    structureReport?.paragraphs ?? [],
    structureHash,
    {
      verifierAvailable: verifierReady,
      toolNames: registryNames.toolNames,
      skillNames: registryNames.skillNames,
    },
  )

  const targets = useMemo(
    () => callTargets(sampleRegistryTools, sampleRegistrySkills),
    [],
  )
  const [pins, setPins] = useState<RegistryPin[]>(() => loadPins())
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const selectedPin = pins.find(p => p.id === selectedPinId) ?? null
  const baselineFor = selectedPin
    ? { prompt: selectedPin.prompt, tools: selectedPin.tools, skills: selectedPin.skills }
    : undefined
  const pinCurrent = () => {
    const label = window.prompt(
      'Label for this baseline pin?',
      `pin-${new Date().toLocaleString()}`,
    )
    if (!label) return
    const next = addPin({
      label,
      prompt: sources.prompt,
      tools: sampleRegistryTools,
      skills: sampleRegistrySkills,
    })
    setPins(next)
    setSelectedPinId(next[next.length - 1].id)
  }
  const removePinAt = (id: string) => {
    setPins(removePin(id))
    if (selectedPinId === id) setSelectedPinId(null)
  }

  const versioning = useVersioning(sources)
  const restoreVersion = (content: string) => {
    setSources(s => ({ ...s, [nav.docType]: content }))
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const label = window.prompt(`Label for this commit of "${nav.docType}"?`, '')
        if (label && label.trim()) {
          versioning.commit(nav.docType, label)
          nav.changeRightPane('history')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav.docType, versioning, nav])

  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissals(structureHash))
  useEffect(() => { setDismissed(loadDismissals(structureHash)) }, [structureHash])
  const onToggleDismiss = (id: string) => setDismissed(toggleDismissal(structureHash, id))
  const onClearDismissals = () => { clearDismissals(structureHash); setDismissed(new Set()) }

  const onEditorChange = (next: string) => {
    setSources(s => ({ ...s, [nav.docType]: next }))
  }
  const onFixNoise = (flag: NoiseFlag) => {
    setSources(s => ({ ...s, [nav.docType]: applyNoiseFix(s[nav.docType], flag) }))
  }
  const jumpToDiagnostic = (d: Diagnostic) => {
    nav.openWorkbench()
    requestAnimationFrame(() => editorRef.current?.jumpTo(d))
  }
  const jumpToOffset = (offset: number) => {
    nav.openWorkbench()
    requestAnimationFrame(() => {
      editorRef.current?.jumpTo({
        ruleId: '',
        severity: 'info',
        message: '',
        range: { startOffset: offset, endOffset: offset + 1 },
      } as Diagnostic)
    })
  }

  // Sync scroll editor ↔ preview (only when the preview tab is showing).
  useEffect(() => {
    if (nav.rightPane !== 'preview') return
    const ctrl = editorRef.current
    if (!ctrl) return
    const off = ctrl.onScroll(() => {
      if (syncingRef.current === 'preview') return
      const preview = previewScrollRef.current
      if (!preview) return
      const pct = ctrl.getScrollPct()
      const pmax = preview.scrollHeight - preview.clientHeight
      if (pmax <= 0) return
      syncingRef.current = 'editor'
      preview.scrollTop = pct * pmax
      requestAnimationFrame(() => { syncingRef.current = null })
    })
    return off
  }, [nav.rightPane])

  const onPreviewScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current === 'editor') return
    const ctrl = editorRef.current
    if (!ctrl) return
    const el = e.currentTarget
    const pmax = el.scrollHeight - el.clientHeight
    if (pmax <= 0) return
    const pct = el.scrollTop / pmax
    syncingRef.current = 'preview'
    ctrl.setScrollPct(pct)
    requestAnimationFrame(() => { syncingRef.current = null })
  }

  const crumbs: Crumb[] = nav.active.scope === 'workspace'
    ? [{ label: 'Workspace' }, { label: workspaceLabel(nav.active.view) }]
    : [{ label: DOC_LABEL[nav.docType] }, { label: rightPaneLabel(nav.rightPane) }]

  const rightContentInner = (() => {
    switch (nav.rightPane) {
      case 'preview':
        return (
          <PreviewPane
            ref={previewScrollRef}
            source={source}
            docType={nav.docType}
            onScroll={onPreviewScroll}
            hoverRange={hoverRange}
          />
        )
      case 'structure':
        if (!structureReport) {
          return <Placeholder title="Structure" note={structure.loading ? 'Analyzing…' : 'No structure report yet.'} />
        }
        return (
          <StructureView
            report={structureReport}
            source={source}
            onJump={jumpToOffset}
            dismissed={dismissed}
            onToggleDismiss={onToggleDismiss}
            onClearDismissals={onClearDismissals}
            onFixNoise={onFixNoise}
            sectionClassifier={sectionClassifier}
            classifierAvailable={openaiReady}
            liveChars={source.length}
            loading={structure.loading}
            stale={structure.stale}
            manualMode={structure.manualMode}
            lastDurationMs={structure.lastDurationMs}
            onReanalyze={structure.reanalyze}
            semantic={semantic}
            onActivateSemantic={semantic.activate}
            onDeactivateSemantic={semantic.deactivate}
            openaiReady={openaiReady}
            openaiReason={openaiReason}
          />
        )
      case 'history':
        return (
          <HistoryView
            docType={nav.docType}
            currentContent={source}
            versions={versioning.versions[nav.docType] ?? []}
            onCommit={label => versioning.commit(nav.docType, label)}
            onRename={(id, label) => versioning.rename(nav.docType, id, label)}
            onDelete={id => versioning.remove(nav.docType, id)}
            onRestore={restoreVersion}
          />
        )
      case 'review':
        return (
          <LLMReviewView
            apiKey={llm.apiKey}
            setApiKey={llm.setApiKey}
            loading={llm.loading}
            output={llm.output}
            error={llm.error}
            onReview={() => llm.review(nav.docType, source, diagnostics)}
          />
        )
    }
  })()

  const rightContent = <Suspense fallback={<ViewFallback />}>{rightContentInner}</Suspense>

  const workbench = (
    <WorkbenchBundle
      source={source}
      docType={nav.docType}
      onDocTypeChange={nav.changeDocType}
      diagnostics={diagnostics}
      sections={sections}
      onChange={onEditorChange}
      theme={theme}
      editorRef={editorRef}
      rightPane={nav.rightPane}
      onRightPaneChange={nav.changeRightPane}
      rightContent={rightContent}
      badges={{
        structure: structureReport?.duplicationClusters.length,
      }}
    />
  )

  const mainViewInner = (() => {
    if (nav.active.scope === 'workbench') return workbench
    switch (nav.active.view) {
      case 'tests':
        return (
          <TestsView
            tests={tests.tests}
            results={tests.results}
            baselineResults={tests.baselineResults}
            loading={tests.loading}
            error={tests.error}
            sidecar={tests.sidecar}
            useMock={useMock}
            onToggleMock={toggleMock}
            runnerConfig={runnerConfig}
            onRunnerConfig={updateRunnerConfig}
            targets={targets}
            pins={pins}
            selectedPinId={selectedPinId}
            onSelectPin={setSelectedPinId}
            onPinCurrent={pinCurrent}
            onRemovePin={removePinAt}
            onClearBaseline={tests.clearBaseline}
            onRunAll={() => tests.run({
              prompt: sources.prompt,
              tools: sampleRegistryTools,
              skills: sampleRegistrySkills,
              config: { mock: useMock, ...runnerConfig },
            }, baselineFor)}
            onRunOne={id => tests.run({
              prompt: sources.prompt,
              tools: sampleRegistryTools,
              skills: sampleRegistrySkills,
              onlyIds: [id],
              config: { mock: useMock, ...runnerConfig },
            }, baselineFor)}
            onCancel={tests.cancel}
            onUpsert={tests.upsert}
            onRemove={tests.remove}
            onReset={tests.reset}
            onClearCache={tests.clearCache}
          />
        )
      case 'registry':
        return <RegistryView findings={registry.findings} onRescan={registry.rescan} />
      case 'settings':
        return (
          <SettingsView
            config={config}
            onChange={updateConfig}
            onReset={resetConfigToDefault}
          />
        )
    }
  })()

  const mainView = <Suspense fallback={<ViewFallback />}>{mainViewInner}</Suspense>

  return (
    <TooltipProvider delayDuration={200}>
      <AppShell
        active={nav.active}
        onOpenWorkbench={nav.openWorkbench}
        onOpenWorkspace={nav.openWorkspace}
        crumbs={crumbs}
        canGoBack={nav.canGoBack}
        onBack={nav.back}
        diagnostics={diagnostics}
        sections={sections}
        onJumpDiagnostic={jumpToDiagnostic}
        onHoverDiagnostic={setHoveredDiag}
        theme={theme}
        onToggleTheme={toggleTheme}
      >
        {mainView}
      </AppShell>
    </TooltipProvider>
  )
}

export default App
