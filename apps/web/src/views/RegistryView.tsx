import { RefreshCw, AlertTriangle } from 'lucide-react'
import type { RegistryFinding } from '@richprompt/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  findings: RegistryFinding[]
  onRescan: () => void
}

const SEV_STYLE: Record<RegistryFinding['severity'], string> = {
  error: 'border-red-500/40 bg-red-500/5',
  warn: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-sky-500/40 bg-sky-500/5',
}

const SEV_BADGE: Record<RegistryFinding['severity'], string> = {
  error: 'border-red-500/40 text-red-600 dark:text-red-400',
  warn: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  info: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
}

export function RegistryView({ findings, onRescan }: Props) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            <span>Registry</span>
            <Badge variant="secondary" className="ml-1">
              {findings.length} issue{findings.length === 1 ? '' : 's'}
            </Badge>
            <div className="ml-auto">
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRescan}>
                <RefreshCw className="h-3 w-3" /> Rescan
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">
              No overlaps detected between registered tools and skills.
            </div>
          ) : (
            <ul className="space-y-2">
              {findings.map((f, i) => (
                <li
                  key={i}
                  className={cn('rounded-md border px-3 py-2', SEV_STYLE[f.severity])}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className={cn('uppercase', SEV_BADGE[f.severity])}>
                      {f.severity}
                    </Badge>
                    <AlertTriangle className="h-3.5 w-3.5 opacity-60" />
                    <span className="font-mono font-semibold">{(f.score * 100).toFixed(0)}%</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{f.docIds[0]}</code>
                    <span className="text-muted-foreground">↔</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{f.docIds[1]}</code>
                  </div>
                  <div className="mt-1.5 text-xs text-foreground/90">{f.message}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
