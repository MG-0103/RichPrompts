import { useEffect, useMemo, useRef, useState } from 'react'
import {
  badPrompt,
  badTool,
  badSkill,
  hashContent,
  parseDocument,
  sampleRegistryTools,
  sampleRegistrySkills,
  type Diagnostic,
  type DocType,
  type Section,
} from '@richprompt/core'
import { useLinter } from './hooks/useLinter'
import { useStructure } from './hooks/useStructure'
import { useSemanticDuplication } from './hooks/useSemanticDuplication'
import { useTests } from './hooks/useTests'
import { loadConfig } from './persistence/config'
import { loadTestingConfig } from './persistence/testConfig'
import { clearDismissals, loadDismissals, toggleDismissal } from './persistence/dismissals'
import { callTargets } from './testing/registry'
import type { RuleConfig } from '@richprompt/core'
import { TooltipProvider } from './components/ui/tooltip'
import { AppShell } from './shell/AppShell'
import { useNavigation } from './shell/useNavigation'
import { viewLabel } from './shell/views'
import type { Crumb } from './shell/Breadcrumbs'
import { Placeholder } from './views/Placeholder'
import { EditorView, type EditorController } from './views/EditorView'
import { StructureView } from './views/StructureView'

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
  const [sources, setSources] = useState<Record<DocType, string>>(FIXTURES)
  const [config] = useState<RuleConfig>(() => loadConfig())
  const source = sources[nav.docType]
  const diagnostics = useLinter(source, nav.docType, config)
  const sections: Section[] = useMemo(
    () => (nav.docType === 'tool' ? [] : parseDocument(source, nav.docType).sections),
    [source, nav.docType],
  )
  const editorRef = useRef<EditorController | null>(null)

  // Structure + semantic duplication (only meaningful for prompt/skill)
  const [runnerConfig] = useState(() => loadTestingConfig())
  const structure = useStructure(source, nav.docType, runnerConfig.model)
  const structureReport = structure.report
  const structureHash = useMemo(
    () => `${nav.docType}:${hashContent(source)}`,
    [nav.docType, source],
  )
  const tests = useTests()
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

  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissals(structureHash))
  useEffect(() => { setDismissed(loadDismissals(structureHash)) }, [structureHash])
  const onToggleDismiss = (id: string) => setDismissed(toggleDismissal(structureHash, id))
  const onClearDismissals = () => { clearDismissals(structureHash); setDismissed(new Set()) }

  const onEditorChange = (next: string) => {
    setSources(s => ({ ...s, [nav.docType]: next }))
  }
  const onJumpDiagnostic = (d: Diagnostic) => {
    if (nav.active.scope !== 'doc' || nav.active.view !== 'editor') {
      nav.selectDocView('editor')
    }
    requestAnimationFrame(() => editorRef.current?.jumpTo(d))
  }
  const onJumpOffset = (offset: number) => {
    if (nav.active.scope !== 'doc' || nav.active.view !== 'editor') {
      nav.selectDocView('editor')
    }
    requestAnimationFrame(() => {
      editorRef.current?.jumpTo({
        ruleId: '',
        severity: 'info',
        message: '',
        range: { startOffset: offset, endOffset: offset + 1 },
      } as Diagnostic)
    })
  }

  const crumbs: Crumb[] = (() => {
    if (nav.active.scope === 'doc') {
      return [
        { label: DOC_LABEL[nav.active.docType] },
        { label: viewLabel(nav.active.view) },
      ]
    }
    return [{ label: 'Workspace' }, { label: viewLabel(nav.active.view) }]
  })()

  const view = (() => {
    if (nav.active.scope === 'doc') {
      switch (nav.active.view) {
        case 'editor':
          return (
            <EditorView
              ref={editorRef}
              source={source}
              docType={nav.docType}
              diagnostics={diagnostics}
              sections={sections}
              onChange={onEditorChange}
            />
          )
        case 'structure':
          if (!structureReport) {
            return <Placeholder title="Structure" note={structure.loading ? 'Analyzing…' : 'No structure report yet.'} />
          }
          return (
            <StructureView
              report={structureReport}
              onJump={onJumpOffset}
              dismissed={dismissed}
              onToggleDismiss={onToggleDismiss}
              onClearDismissals={onClearDismissals}
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
          return <Placeholder title="History" note="History view migration lands in N6." />
        case 'review':
          return <Placeholder title="LLM Review" note="LLM Review migration lands in N7." />
      }
    }
    switch (nav.active.view) {
      case 'tests':
        return <Placeholder title="Tests" note="Tests view migration lands in N5." />
      case 'registry':
        return <Placeholder title="Registry" note="Registry migration lands in N8." />
      case 'settings':
        return <Placeholder title="Settings" note="Settings migration lands in N9." />
    }
  })()

  return (
    <TooltipProvider delayDuration={200}>
      <AppShell
        active={nav.active}
        docType={nav.docType}
        onDocTypeChange={nav.changeDocType}
        onSelectDocView={nav.selectDocView}
        onSelectWorkspaceView={nav.selectWorkspaceView}
        crumbs={crumbs}
        canGoBack={nav.canGoBack}
        onBack={nav.back}
        diagnostics={diagnostics}
        onJumpDiagnostic={onJumpDiagnostic}
      >
        {view}
      </AppShell>
    </TooltipProvider>
  )
}

export default App
