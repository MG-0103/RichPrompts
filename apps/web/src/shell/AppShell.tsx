import type { ReactNode } from 'react'
import type { Diagnostic, Section } from '@richprompt/core'
import { TopNavbar } from './TopNavbar'
import { Breadcrumbs, type Crumb } from './Breadcrumbs'
import { ProblemsStrip } from './ProblemsStrip'
import type { ActiveView, WorkspaceView } from './views'
import type { Theme } from './useTheme'

interface Props {
  active: ActiveView
  onOpenWorkbench: () => void
  onOpenWorkspace: (view: WorkspaceView) => void
  crumbs: Crumb[]
  canGoBack: boolean
  onBack: () => void
  diagnostics: Diagnostic[]
  sections: Section[]
  onJumpDiagnostic?: (d: Diagnostic) => void
  onHoverDiagnostic?: (d: Diagnostic | null) => void
  onFixDiagnostic?: (d: Diagnostic) => void
  theme: Theme
  onToggleTheme: () => void
  children: ReactNode
}

export function AppShell({
  active,
  onOpenWorkbench,
  onOpenWorkspace,
  crumbs,
  canGoBack,
  onBack,
  diagnostics,
  sections,
  onJumpDiagnostic,
  onHoverDiagnostic,
  onFixDiagnostic,
  theme,
  onToggleTheme,
  children,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopNavbar
        active={active}
        onOpenWorkbench={onOpenWorkbench}
        onOpenWorkspace={onOpenWorkspace}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <Breadcrumbs crumbs={crumbs} canGoBack={canGoBack} onBack={onBack} />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <ProblemsStrip
        diagnostics={diagnostics}
        sections={sections}
        onJump={onJumpDiagnostic}
        onHoverDiagnostic={onHoverDiagnostic}
        onFixDiagnostic={onFixDiagnostic}
      />
    </div>
  )
}
