import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocType, Version } from '@richprompt/core'
import {
  commit as commitFn,
  deleteVersion as deleteVersionFn,
  loadAllVersions,
  pushAuto,
  renameVersion as renameVersionFn,
} from '../persistence/versions'

const AUTO_DEBOUNCE_MS = 2000

/**
 * Owns:
 * - per-doc auto snapshotting on a 2s idle debounce
 * - commit / rename / delete actions
 * - the versions map exposed to the UI
 */
export function useVersioning(sources: Record<DocType, string>) {
  const [versions, setVersions] = useState<Record<string, Version[]>>(() => loadAllVersions())
  const timers = useRef<Partial<Record<DocType, number>>>({})
  const latest = useRef(sources)
  latest.current = sources

  useEffect(() => {
    // Every source change schedules an auto-save for that docId only.
    for (const docId of Object.keys(sources) as DocType[]) {
      if (timers.current[docId]) window.clearTimeout(timers.current[docId])
      timers.current[docId] = window.setTimeout(() => {
        const content = latest.current[docId]
        if (typeof content !== 'string') return
        const updated = pushAuto(docId, content)
        setVersions(v => ({ ...v, [docId]: updated }))
      }, AUTO_DEBOUNCE_MS)
    }
    return () => {
      // On unmount, clear pending timers but don't force-save — that would
      // race with the persistence read on the next mount.
      for (const t of Object.values(timers.current)) if (t) window.clearTimeout(t)
    }
    // Depend on the concrete source strings so retyping keeps rescheduling.
  }, [sources.prompt, sources.tool, sources.skill])

  const commit = useCallback((docId: DocType, label: string) => {
    const updated = commitFn(docId, latest.current[docId], label)
    setVersions(v => ({ ...v, [docId]: updated }))
  }, [])

  const rename = useCallback((docId: DocType, id: string, label: string) => {
    const updated = renameVersionFn(docId, id, label)
    setVersions(v => ({ ...v, [docId]: updated }))
  }, [])

  const remove = useCallback((docId: DocType, id: string) => {
    const updated = deleteVersionFn(docId, id)
    setVersions(v => ({ ...v, [docId]: updated }))
  }, [])

  return { versions, commit, rename, remove }
}
