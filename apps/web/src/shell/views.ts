export type RightPaneView = 'preview' | 'structure' | 'history' | 'review'
export type WorkspaceView = 'tests' | 'registry' | 'settings'

export type ActiveView =
  | { scope: 'workbench' }
  | { scope: 'workspace'; view: WorkspaceView }

export const RIGHT_PANE_VIEWS: { key: RightPaneView; label: string }[] = [
  { key: 'preview', label: 'Preview' },
  { key: 'structure', label: 'Structure' },
  { key: 'history', label: 'History' },
  { key: 'review', label: 'LLM Review' },
]

export const WORKSPACE_VIEWS: { key: WorkspaceView; label: string }[] = [
  { key: 'tests', label: 'Tests' },
  { key: 'registry', label: 'Registry' },
  { key: 'settings', label: 'Settings' },
]

export function rightPaneLabel(v: RightPaneView): string {
  return RIGHT_PANE_VIEWS.find(x => x.key === v)?.label ?? v
}

export function workspaceLabel(v: WorkspaceView): string {
  return WORKSPACE_VIEWS.find(x => x.key === v)?.label ?? v
}
