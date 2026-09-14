import { useCallback, useEffect, useState } from 'react'
import {
  buildRegistry,
  runRegistryRules,
  sampleRegistryTools,
  sampleRegistrySkills,
  type RegistryFinding,
} from '@richprompt/core'

export function useRegistry() {
  const [findings, setFindings] = useState<RegistryFinding[]>([])

  const rescan = useCallback(() => {
    const registry = buildRegistry(sampleRegistryTools, sampleRegistrySkills)
    setFindings(runRegistryRules(registry))
  }, [])

  useEffect(() => { rescan() }, [rescan])

  return { findings, rescan }
}
