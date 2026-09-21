import type { DocType } from '@richprompt/core'

export type DocView = 'editor' | 'structure' | 'history' | 'review'
export type WorkspaceView = 'tests' | 'registry' | 'settings'
export type ViewKey = DocView | WorkspaceView

export type ActiveView =
  | { scope: 'doc'; view: DocView; docType: DocType }
  | { scope: 'workspace'; view: WorkspaceView }

export const DOC_VIEWS: { key: DocView; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'structure', label: 'Structure' },
  { key: 'history', label: 'History' },
  { key: 'review', label: 'LLM Review' },
]

export const WORKSPACE_VIEWS: { key: WorkspaceView; label: string }[] = [
  { key: 'tests', label: 'Tests' },
  { key: 'registry', label: 'Registry' },
  { key: 'settings', label: 'Settings' },
]

export function viewLabel(view: ViewKey): string {
  const doc = DOC_VIEWS.find(v => v.key === view)
  if (doc) return doc.label
  const ws = WORKSPACE_VIEWS.find(v => v.key === view)
  return ws?.label ?? view
}
