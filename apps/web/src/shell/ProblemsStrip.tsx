import { useState } from 'react'
import { AlertTriangle, Info, ChevronUp, ChevronDown, XCircle } from 'lucide-react'
import type { Diagnostic } from '@richprompt/core'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  diagnostics: Diagnostic[]
  onJump?: (d: Diagnostic) => void
}

const SEVERITY_META: Record<
  Diagnostic['severity'],
  { icon: typeof AlertTriangle; label: string; className: string }
> = {
  error: { icon: XCircle, label: 'error', className: 'text-red-500' },
  warn: { icon: AlertTriangle, label: 'warn', className: 'text-amber-500' },
  info: { icon: Info, label: 'info', className: 'text-sky-500' },
}

export function ProblemsStrip({ diagnostics, onJump }: Props) {
  const [expanded, setExpanded] = useState(false)
  const counts = {
    error: diagnostics.filter(d => d.severity === 'error').length,
    warn: diagnostics.filter(d => d.severity === 'warn').length,
    info: diagnostics.filter(d => d.severity === 'info').length,
  }
  const total = diagnostics.length

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <button
        className="flex h-8 w-full items-center gap-3 px-3 text-xs hover:bg-accent/40"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="font-medium">Problems</span>
        <Badge variant={total === 0 ? 'outline' : 'secondary'} className="h-5 px-1.5">
          {total}
        </Badge>
        <div className="flex items-center gap-2 text-muted-foreground">
          {(['error', 'warn', 'info'] as const).map(sev => {
            const Icon = SEVERITY_META[sev].icon
            return (
              <span key={sev} className="flex items-center gap-1">
                <Icon className={cn('h-3.5 w-3.5', SEVERITY_META[sev].className)} />
                <span>{counts[sev]}</span>
              </span>
            )
          })}
        </div>
        <span className="ml-auto text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <div className="max-h-48 overflow-auto border-t border-border">
          {diagnostics.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No problems detected.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {diagnostics.map((d, i) => {
                const meta = SEVERITY_META[d.severity]
                const Icon = meta.icon
                return (
                  <li key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent/30">
                    <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.className)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="text-foreground">{d.message}</span>
                        <span className="ml-2 text-muted-foreground">{d.ruleId}</span>
                      </div>
                    </div>
                    {onJump && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onJump(d)}
                      >
                        Jump
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
