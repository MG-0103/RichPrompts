import { useMemo, useRef, useState } from 'react'
import {
  badPrompt,
  badTool,
  badSkill,
  parseDocument,
  type Diagnostic,
  type DocType,
  type Section,
} from '@richprompt/core'
import { useLinter } from './hooks/useLinter'
import { loadConfig } from './persistence/config'
import type { RuleConfig } from '@richprompt/core'
import { TooltipProvider } from './components/ui/tooltip'
import { AppShell } from './shell/AppShell'
import { useNavigation } from './shell/useNavigation'
import { viewLabel } from './shell/views'
import type { Crumb } from './shell/Breadcrumbs'
import { Placeholder } from './views/Placeholder'
import { EditorView, type EditorController } from './views/EditorView'

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
    () => nav.docType === 'tool' ? [] : parseDocument(source, nav.docType).sections,
    [source, nav.docType],
  )
  const editorRef = useRef<EditorController | null>(null)

  const onEditorChange = (next: string) => {
    setSources(s => ({ ...s, [nav.docType]: next }))
  }
  const onJumpDiagnostic = (d: Diagnostic) => {
    if (nav.active.scope !== 'doc' || nav.active.view !== 'editor') {
      nav.selectDocView('editor')
    }
    requestAnimationFrame(() => editorRef.current?.jumpTo(d))
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
          return <Placeholder title="Structure" note="Structure panel migration lands in N4." />
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
