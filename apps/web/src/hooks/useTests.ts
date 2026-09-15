import { useCallback, useEffect, useRef, useState } from 'react'
import type { TestCase, TestResult, TestRunRequest } from '@richprompt/core'
import { loadTests, resetTests, saveTests } from '../persistence/tests'
import { checkHealth, clearCache as clearCacheReq, runTests } from '../testing/client'

export type SidecarStatus =
  | { state: 'unknown' }
  | {
      state: 'up'
      version?: string
      mode?: string
      real?: { available: boolean; reason?: string | null }
    }
  | { state: 'down' }

export function useTests() {
  const [tests, setTestsState] = useState<TestCase[]>(() => loadTests())
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [baselineResults, setBaselineResults] = useState<Record<string, TestResult>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidecar, setSidecar] = useState<SidecarStatus>({ state: 'unknown' })
  const abortRef = useRef<AbortController | null>(null)

  const setTests = useCallback((next: TestCase[]) => {
    setTestsState(next)
    saveTests(next)
  }, [])

  const upsert = useCallback((tc: TestCase) => {
    setTests(mergeById(tests, tc))
  }, [tests, setTests])

  const remove = useCallback((id: string) => {
    setTests(tests.filter(t => t.id !== id))
    setResults(r => {
      if (!(id in r)) return r
      const rest: Record<string, TestResult> = {}
      for (const k of Object.keys(r)) if (k !== id) rest[k] = r[k]
      return rest
    })
  }, [tests, setTests])

  const reset = useCallback(() => setTestsState(resetTests()), [])

  const refreshHealth = useCallback(async () => {
    const h = await checkHealth()
    setSidecar(
      h.ok
        ? { state: 'up', version: h.version, mode: h.mode, real: h.real }
        : { state: 'down' },
    )
  }, [])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const run = useCallback(async (
    req: Omit<TestRunRequest, 'testCases'> & { onlyIds?: string[] },
    baseline?: { prompt: string; tools: TestRunRequest['tools']; skills: TestRunRequest['skills'] },
  ) => {
    setError(null)
    const cases = req.onlyIds
      ? tests.filter(t => req.onlyIds!.includes(t.id))
      : tests
    if (cases.length === 0) return
    setLoading(true)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      // Fire current + baseline in parallel; each is cached separately.
      const promises = [runTests({
        prompt: req.prompt,
        tools: req.tools,
        skills: req.skills,
        testCases: cases,
        config: req.config,
      }, ctrl.signal)]
      if (baseline) {
        promises.push(runTests({
          prompt: baseline.prompt,
          tools: baseline.tools,
          skills: baseline.skills,
          testCases: cases,
          config: req.config,
        }, ctrl.signal))
      }
      const [current, base] = await Promise.all(promises)
      setResults(prev => {
        const next = { ...prev }
        for (const r of current.results) next[r.testId] = r
        return next
      })
      if (base) {
        setBaselineResults(prev => {
          const next = { ...prev }
          for (const r of base.results) next[r.testId] = r
          return next
        })
      }
      refreshHealth()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
        refreshHealth()
      }
    } finally {
      setLoading(false)
    }
  }, [tests, refreshHealth])

  const clearBaseline = useCallback(() => setBaselineResults({}), [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  const clearCache = useCallback(async () => {
    await clearCacheReq()
    setResults({})
    setBaselineResults({})
    refreshHealth()
  }, [refreshHealth])

  return {
    tests, results, baselineResults, loading, error, sidecar,
    run, cancel, upsert, remove, reset, clearCache, clearBaseline,
  }
}

function mergeById(list: TestCase[], next: TestCase): TestCase[] {
  const idx = list.findIndex(t => t.id === next.id)
  if (idx < 0) return [...list, next]
  const copy = list.slice()
  copy[idx] = next
  return copy
}
