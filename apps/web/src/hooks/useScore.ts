import { useEffect, useMemo, useState } from 'react'
import {
  scoreDiagnostics,
  hashContent,
  type Diagnostic,
  type DocType,
} from '@richprompt/core'
import { loadSnapshots, pushSnapshot, type Snapshot } from '../persistence/snapshots'

const SNAPSHOT_DEBOUNCE_MS = 1500

export function useScore(source: string, docType: DocType, diagnostics: Diagnostic[]) {
  const breakdown = useMemo(() => scoreDiagnostics(diagnostics), [diagnostics])
  const [history, setHistory] = useState<Snapshot[]>(() => loadSnapshots(docType))

  useEffect(() => {
    setHistory(loadSnapshots(docType))
  }, [docType])

  useEffect(() => {
    const t = setTimeout(() => {
      const snap: Snapshot = {
        docId: docType,
        contentHash: hashContent(source),
        timestamp: Date.now(),
        score: breakdown.score,
        errorCount: breakdown.errorCount,
        warnCount: breakdown.warnCount,
        infoCount: breakdown.infoCount,
        charCount: source.length,
      }
      const next = pushSnapshot(snap)
      setHistory(next)
    }, SNAPSHOT_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [source, docType, breakdown])

  return { breakdown, history }
}
