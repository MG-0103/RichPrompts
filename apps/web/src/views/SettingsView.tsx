import { useRef, useState } from 'react'
import { Download, Upload, RotateCcw } from 'lucide-react'
import { allRules, defaultConfig, type RuleConfig, type Severity } from '@richprompt/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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

const SEV_STYLE: Record<Severity, string> = {
  error: 'text-red-500',
  warn: 'text-amber-500',
  info: 'text-sky-500',
}

export function SettingsView({ config, onChange, onReset }: Props) {
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
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            <span>Rule configuration</span>
            <Badge variant="outline" className="text-[10px]">persisted in browser</Badge>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={exportJson}>
                <Download className="h-3 w-3" /> Export
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" /> Import
              </Button>
              <Button variant="destructive" size="sm" className="h-7 gap-1 text-xs" onClick={onReset}>
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {importErr && (
            <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
              Import failed: {importErr}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Thresholds</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(Object.keys(config.thresholds) as (keyof RuleConfig['thresholds'])[]).map(key => (
            <div key={key} className="flex items-center gap-3">
              <label className="flex-1 text-xs text-muted-foreground">{THRESHOLD_LABELS[key]}</label>
              <Input
                type="number"
                min={0}
                value={config.thresholds[key]}
                onChange={e => setThreshold(key, Number(e.target.value))}
                className="h-8 w-24 text-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            Rules <Badge variant="secondary" className="ml-1">{allRules.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-16 py-1.5 pr-2 font-medium">Enabled</th>
                  <th className="py-1.5 pr-2 font-medium">Rule</th>
                  <th className="py-1.5 pr-2 font-medium">Pack</th>
                  <th className="py-1.5 pr-2 font-medium">Default</th>
                  <th className="py-1.5 font-medium">Override</th>
                </tr>
              </thead>
              <tbody>
                {allRules.map(r => {
                  const disabled = config.disabled.includes(r.id)
                  const override = config.severityOverrides[r.id] ?? ''
                  return (
                    <tr
                      key={r.id}
                      className={cn('border-b border-border/40', disabled && 'opacity-50')}
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={!disabled}
                          onChange={() => toggleRule(r.id)}
                          className="h-3.5 w-3.5"
                        />
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{r.id}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{r.pack}</td>
                      <td className={cn('py-1.5 pr-2 font-mono', SEV_STYLE[r.defaultSeverity])}>
                        {r.defaultSeverity}
                      </td>
                      <td className="py-1.5">
                        <Select
                          value={override}
                          disabled={disabled}
                          onChange={e => setSeverity(r.id, e.target.value as Severity | '')}
                          className="h-7 text-xs"
                        >
                          <option value="">(default)</option>
                          {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
