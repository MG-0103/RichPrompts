import { useRef, useState } from 'react'
import { allRules, defaultConfig, type RuleConfig, type Severity } from '@richprompt/core'

interface Props {
  config: RuleConfig
  onChange: (cfg: RuleConfig) => void
  onReset: () => void
}

const SEVERITIES: Severity[] = ['error', 'warn', 'info']

const THRESHOLD_LABELS: Record<keyof RuleConfig['thresholds'], string> = {
  promptMaxChars: 'Max chars before too-long fires',
  instructionStackingMax: 'Max rule-like lines before stacking fires',
  emphaticTokensMax: 'Max CRITICAL/MUST/… tokens before inflation fires',
  negativeInstructionsMax: 'Max negative-only lines before flagging',
}

export function SettingsPanel({ config, onChange, onReset }: Props) {
  const [importErr, setImportErr] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const toggleRule = (id: string) => {
    const disabled = config.disabled.includes(id)
      ? config.disabled.filter(x => x !== id)
      : [...config.disabled, id]
    onChange({ ...config, disabled })
  }

  const setSeverity = (id: string, sev: Severity | '') => {
    const overrides = { ...config.severityOverrides }
    if (sev === '') delete overrides[id]
    else overrides[id] = sev
    onChange({ ...config, severityOverrides: overrides })
  }

  const setThreshold = (key: keyof RuleConfig['thresholds'], value: number) => {
    onChange({ ...config, thresholds: { ...config.thresholds, [key]: value } })
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'richprompt.config.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = (file: File) => {
    setImportErr(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<RuleConfig>
        onChange({
          thresholds: { ...defaultConfig.thresholds, ...(parsed.thresholds ?? {}) },
          disabled: parsed.disabled ?? [],
          severityOverrides: parsed.severityOverrides ?? {},
        })
      } catch (e) {
        setImportErr(e instanceof Error ? e.message : String(e))
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>Rule configuration — persisted in browser</span>
        <div className="settings-actions">
          <button className="rescan-btn" onClick={exportJson}>Export</button>
          <button className="rescan-btn" onClick={() => fileInputRef.current?.click()}>Import</button>
          <button className="rescan-btn danger" onClick={onReset}>Reset</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }}
          />
        </div>
      </div>

      {importErr && <div className="llm-error">Import failed: {importErr}</div>}

      <div className="settings-section">
        <div className="settings-section-title">Thresholds</div>
        {(Object.keys(config.thresholds) as (keyof RuleConfig['thresholds'])[]).map(key => (
          <div className="threshold-row" key={key}>
            <label>{THRESHOLD_LABELS[key]}</label>
            <input
              type="number"
              min={0}
              value={config.thresholds[key]}
              onChange={e => setThreshold(key, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Rules ({allRules.length})</div>
        <table className="rules-table">
          <thead>
            <tr><th>Enabled</th><th>Rule</th><th>Pack</th><th>Default</th><th>Override</th></tr>
          </thead>
          <tbody>
            {allRules.map(r => {
              const disabled = config.disabled.includes(r.id)
              const override = config.severityOverrides[r.id] ?? ''
              return (
                <tr key={r.id} className={disabled ? 'row-disabled' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!disabled}
                      onChange={() => toggleRule(r.id)}
                    />
                  </td>
                  <td className="rule-cell">{r.id}</td>
                  <td className="pack-cell">{r.pack}</td>
                  <td className={`sev sev-${r.defaultSeverity}`}>{r.defaultSeverity}</td>
                  <td>
                    <select
                      value={override}
                      disabled={disabled}
                      onChange={e => setSeverity(r.id, e.target.value as Severity | '')}
                    >
                      <option value="">(default)</option>
                      {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
