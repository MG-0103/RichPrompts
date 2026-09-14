import { useState } from 'react'

interface Props {
  apiKey: string
  setApiKey: (k: string) => void
  loading: boolean
  output: string
  error: string | null
  onReview: () => void
}

export function LLMReviewPanel({ apiKey, setApiKey, loading, output, error, onReview }: Props) {
  const [showKey, setShowKey] = useState(false)
  return (
    <div className="llm-panel">
      <div className="llm-header">
        <span className="llm-badge">Tier 3 — Subjective LLM Review</span>
        <button className="rescan-btn" onClick={onReview} disabled={loading || !apiKey}>
          {loading ? 'Reviewing…' : 'Run review'}
        </button>
      </div>
      <div className="llm-keyrow">
        <input
          type={showKey ? 'text' : 'password'}
          className="llm-key"
          placeholder="sk-ant-… (stored in localStorage; never sent anywhere but api.anthropic.com)"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <button className="llm-toggle" onClick={() => setShowKey(s => !s)}>
          {showKey ? 'hide' : 'show'}
        </button>
      </div>
      {error && <div className="llm-error">{error}</div>}
      {output && <pre className="llm-output">{output}</pre>}
      {!output && !error && !loading && (
        <div className="llm-hint">
          Optional. LLM reviews are subjective; treat output as suggestions, not truth.
          Direct browser calls to Anthropic API — your key stays in this browser.
        </div>
      )}
    </div>
  )
}
