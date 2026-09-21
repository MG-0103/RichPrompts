import type { ReactNode } from 'react'
import type { DocType, Diagnostic } from '@richprompt/core'
import { TopNavbar } from './TopNavbar'
import { Breadcrumbs, type Crumb } from './Breadcrumbs'
import { ProblemsStrip } from './ProblemsStrip'
import type { ActiveView, DocView, WorkspaceView } from './views'

interface Props {
  active: ActiveView
  docType: DocType
  onDocTypeChange: (d: DocType) => void
  onSelectDocView: (view: DocView) => void
  onSelectWorkspaceView: (view: WorkspaceView) => void
  crumbs: Crumb[]
  canGoBack: boolean
  onBack: () => void
  diagnostics: Diagnostic[]
  onJumpDiagnostic?: (d: Diagnostic) => void
  children: ReactNode
}

export function AppShell({
  active,
  docType,
  onDocTypeChange,
  onSelectDocView,
  onSelectWorkspaceView,
  crumbs,
  canGoBack,
  onBack,
  diagnostics,
  onJumpDiagnostic,
  children,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopNavbar
        active={active}
        docType={docType}
        onDocTypeChange={onDocTypeChange}
        onSelectDocView={onSelectDocView}
        onSelectWorkspaceView={onSelectWorkspaceView}
      />
      <Breadcrumbs crumbs={crumbs} canGoBack={canGoBack} onBack={onBack} />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      <ProblemsStrip diagnostics={diagnostics} onJump={onJumpDiagnostic} />
    </div>
  )
}
