import { useCallback, useState } from 'react'
import type { Diagnostic, DocType } from '@richprompt/core'
import { reviewWithClaude } from '../llm/anthropic'

const KEY_STORAGE = 'richprompt.anthropic.apiKey'

export function useLLMReview() {
  const [apiKey, setApiKeyState] = useState<string>(() => localStorage.getItem(KEY_STORAGE) ?? '')
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const setApiKey = useCallback((k: string) => {
    setApiKeyState(k)
    if (k) localStorage.setItem(KEY_STORAGE, k)
    else localStorage.removeItem(KEY_STORAGE)
  }, [])

  const review = useCallback(async (docType: DocType, source: string, diagnostics: Diagnostic[]) => {
    if (!apiKey) { setError('API key required.'); return }
    setLoading(true); setError(null); setOutput('')
    try {
      const text = await reviewWithClaude({ apiKey, docType, source, diagnostics })
      setOutput(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [apiKey])

  return { apiKey, setApiKey, loading, output, error, review }
}
