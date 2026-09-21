import { useCallback, useEffect, useState } from 'react'
import type { DocType } from '@richprompt/core'
import type { ActiveView, RightPaneView, WorkspaceView } from './views'

const STORAGE_KEY = 'richprompt.nav.last'

interface Stored {
  active: ActiveView
  rightPane: RightPaneView
  docType: DocType
}

function loadInitial(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch { /* ignore */ }
  return {
    active: { scope: 'workbench' },
    rightPane: 'preview',
    docType: 'prompt',
  }
}

export function useNavigation() {
  const initial = loadInitial()
  const [docType, setDocType] = useState<DocType>(initial.docType)
  const [active, setActive] = useState<ActiveView>(initial.active)
  const [rightPane, setRightPane] = useState<RightPaneView>(initial.rightPane)
  const [stack, setStack] = useState<ActiveView[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, rightPane, docType }))
    } catch { /* ignore */ }
  }, [active, rightPane, docType])

  const openWorkspace = useCallback((view: WorkspaceView) => {
    setActive(prev => {
      if (prev.scope === 'workspace' && prev.view === view) return prev
      setStack(s => [...s, prev])
      return { scope: 'workspace', view }
    })
  }, [])

  const openWorkbench = useCallback(() => {
    setActive(prev => {
      if (prev.scope === 'workbench') return prev
      setStack(s => [...s, prev])
      return { scope: 'workbench' }
    })
  }, [])

  const back = useCallback(() => {
    setStack(s => {
      if (s.length === 0) return s
      const next = s[s.length - 1]
      setActive(next)
      return s.slice(0, -1)
    })
  }, [])

  const changeDocType = useCallback((d: DocType) => setDocType(d), [])
  const changeRightPane = useCallback((v: RightPaneView) => setRightPane(v), [])

  return {
    active,
    docType,
    rightPane,
    canGoBack: stack.length > 0,
    openWorkspace,
    openWorkbench,
    changeDocType,
    changeRightPane,
    back,
  }
}
