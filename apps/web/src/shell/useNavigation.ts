import { useCallback, useEffect, useState } from 'react'
import type { DocType } from '@richprompt/core'
import type { ActiveView, DocView, WorkspaceView } from './views'

const STORAGE_KEY = 'richprompt.nav.last'

interface Stored {
  active: ActiveView
  docType: DocType
}

function loadInitial(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch { /* ignore */ }
  return { active: { scope: 'doc', view: 'editor', docType: 'prompt' }, docType: 'prompt' }
}

function sameView(a: ActiveView, b: ActiveView): boolean {
  if (a.scope !== b.scope) return false
  if (a.scope === 'doc' && b.scope === 'doc') {
    return a.view === b.view && a.docType === b.docType
  }
  if (a.scope === 'workspace' && b.scope === 'workspace') return a.view === b.view
  return false
}

export function useNavigation() {
  const initial = loadInitial()
  const [docType, setDocType] = useState<DocType>(initial.docType)
  const [active, setActive] = useState<ActiveView>(initial.active)
  const [stack, setStack] = useState<ActiveView[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, docType }))
    } catch { /* ignore */ }
  }, [active, docType])

  const push = useCallback((next: ActiveView) => {
    setActive(prev => {
      if (sameView(prev, next)) return prev
      setStack(s => [...s, prev])
      return next
    })
  }, [])

  const selectDocView = useCallback(
    (view: DocView) => push({ scope: 'doc', view, docType }),
    [push, docType],
  )

  const selectWorkspaceView = useCallback(
    (view: WorkspaceView) => push({ scope: 'workspace', view }),
    [push],
  )

  const changeDocType = useCallback((d: DocType) => {
    setDocType(d)
    setActive(prev => {
      if (prev.scope === 'doc') {
        const next: ActiveView = { scope: 'doc', view: prev.view, docType: d }
        if (!sameView(prev, next)) setStack(s => [...s, prev])
        return next
      }
      return prev
    })
  }, [])

  const back = useCallback(() => {
    setStack(s => {
      if (s.length === 0) return s
      const next = s[s.length - 1]
      setActive(next)
      if (next.scope === 'doc') setDocType(next.docType)
      return s.slice(0, -1)
    })
  }, [])

  return {
    active,
    docType,
    canGoBack: stack.length > 0,
    selectDocView,
    selectWorkspaceView,
    changeDocType,
    back,
  }
}
