/**
 * State for the "propose merge" flow in the Duplication view.
 *
 * The user clicks Merge… on a cluster → we call the sidecar's
 * /merge-cluster endpoint with the cluster's member texts, get back
 * one merged paragraph plus a rationale, and hold that state until
 * they Apply or Cancel. Apply is a synchronous callback the App
 * wires to a source rewrite (replace first member, delete the
 * others).
 *
 * Cache is per-session (in-memory Map) so re-opening the same cluster
 * in one tab session is instant. Cross-tab persistence is intentionally
 * out of scope — the merged text depends on the paragraph content and
 * the LLM run, and stale caches would silently drift.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { DuplicationCluster, Paragraph } from '@richprompt/core'
import { mergeCluster, type MergeResult } from '../testing/merge'

/** Members captured at merge-open time so the range positions are
 *  stable even if the source is edited before Apply runs. */
export interface MergeMember {
  id: string
  text: string
  startOffset: number
  endOffset: number
  section?: string
  heading?: string | null
}

export interface ActiveMerge {
  clusterId: string
  members: MergeMember[]
  proposed: string
  reason: string
  cached: boolean
  loading: boolean
  error: string | null
  /** Whatever the user edited in the merge view — starts equal to
   *  `proposed`, diverges as they type. Applied on Apply. */
  edited: string
}

export interface ClusterMergeState {
  active: ActiveMerge | null
  open: (cluster: DuplicationCluster, paragraphs: Paragraph[]) => Promise<void>
  setEdited: (next: string) => void
  regenerate: () => Promise<void>
  close: () => void
}

/** Order-independent hash of the member texts, matches the sidecar. */
function keyOf(texts: string[]): string {
  return texts.slice().sort().join('\0')
}

export function useClusterMerge(): ClusterMergeState {
  const [active, setActive] = useState<ActiveMerge | null>(null)
  const cacheRef = useRef<Map<string, { merged: string; reason: string }>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const open = useCallback(
    async (cluster: DuplicationCluster, paragraphs: Paragraph[]) => {
      abortRef.current?.abort()
      const byId = new Map(paragraphs.map(p => [p.id, p]))
      const members: MergeMember[] = cluster.paragraphIds
        .map(id => byId.get(id))
        .filter((p): p is Paragraph => !!p)
        .map(p => ({
          id: p.id,
          text: p.text,
          startOffset: p.startOffset,
          endOffset: p.endOffset,
          section: p.section,
          heading: p.heading,
        }))
      if (members.length < 2) {
        const missing = cluster.paragraphIds.length - members.length
        setActive({
          clusterId: cluster.id,
          members: [],
          proposed: '',
          reason: '',
          cached: false,
          loading: false,
          error:
            `Cluster references ${cluster.paragraphIds.length} paragraph` +
            `${cluster.paragraphIds.length === 1 ? '' : 's'}, but only ` +
            `${members.length} exist in the current document ` +
            `(${missing} missing). The Deep Analyze cache is out of sync — ` +
            `hit Re-analyze in the Structure view to rebuild.`,
          edited: '',
        })
        return
      }

      const cacheKey = keyOf(members.map(m => m.text))
      const hit = cacheRef.current.get(cacheKey)
      if (hit) {
        setActive({
          clusterId: cluster.id,
          members,
          proposed: hit.merged,
          reason: hit.reason,
          cached: true,
          loading: false,
          error: null,
          edited: hit.merged,
        })
        return
      }

      setActive({
        clusterId: cluster.id,
        members,
        proposed: '',
        reason: '',
        cached: false,
        loading: true,
        error: null,
        edited: '',
      })
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const res: MergeResult = await mergeCluster(
          members.map(m => m.text),
          { signal: ctrl.signal },
        )
        if (ctrl.signal.aborted) return
        cacheRef.current.set(cacheKey, { merged: res.merged, reason: res.reason })
        setActive(prev =>
          prev && prev.clusterId === cluster.id
            ? {
                ...prev,
                proposed: res.merged,
                reason: res.reason,
                cached: res.cached,
                loading: false,
                edited: res.merged,
              }
            : prev,
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setActive(prev =>
          prev && prev.clusterId === cluster.id
            ? { ...prev, loading: false, error: (e as Error).message }
            : prev,
        )
      }
    },
    [],
  )

  const setEdited = useCallback((next: string) => {
    setActive(prev => (prev ? { ...prev, edited: next } : prev))
  }, [])

  const regenerate = useCallback(async () => {
    const cur = active
    if (!cur) return
    // Invalidate cache for this member set, then re-fetch.
    cacheRef.current.delete(keyOf(cur.members.map(m => m.text)))
    abortRef.current?.abort()
    setActive({ ...cur, loading: true, error: null })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await mergeCluster(cur.members.map(m => m.text), { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      cacheRef.current.set(keyOf(cur.members.map(m => m.text)), {
        merged: res.merged,
        reason: res.reason,
      })
      setActive(prev =>
        prev
          ? {
              ...prev,
              proposed: res.merged,
              reason: res.reason,
              cached: res.cached,
              loading: false,
              edited: res.merged,
            }
          : prev,
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setActive(prev => (prev ? { ...prev, loading: false, error: (e as Error).message } : prev))
    }
  }, [active])

  const close = useCallback(() => {
    abortRef.current?.abort()
    setActive(null)
  }, [])

  return useMemo(
    () => ({ active, open, setEdited, regenerate, close }),
    [active, open, setEdited, regenerate, close],
  )
}
