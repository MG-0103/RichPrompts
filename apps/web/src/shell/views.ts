export type RightPaneView = 'preview' | 'structure' | 'history' | 'review' | 'merge'
export type WorkspaceView = 'tests' | 'registry' | 'settings'

export type ActiveView =
  | { scope: 'workbench' }
  | { scope: 'workspace'; view: WorkspaceView }

export const RIGHT_PANE_VIEWS: { key: RightPaneView; label: string }[] = [
  { key: 'preview', label: 'Preview' },
  { key: 'structure', label: 'Structure' },
  { key: 'history', label: 'History' },
  { key: 'review', label: 'LLM Review' },
  // 'merge' is hidden from the tab bar — it's opened contextually
  // from the Duplication view and dismissed on Apply/Cancel.
]

export const WORKSPACE_VIEWS: { key: WorkspaceView; label: string }[] = [
  { key: 'tests', label: 'Tests' },
  { key: 'registry', label: 'Registry' },
  { key: 'settings', label: 'Settings' },
]

export function rightPaneLabel(v: RightPaneView): string {
  if (v === 'merge') return 'Merge'
  return RIGHT_PANE_VIEWS.find(x => x.key === v)?.label ?? v
}

export function workspaceLabel(v: WorkspaceView): string {
  return WORKSPACE_VIEWS.find(x => x.key === v)?.label ?? v
}
