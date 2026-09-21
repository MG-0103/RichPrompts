import { AlertCircle, Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ActiveMerge } from '@/hooks/useClusterMerge'

interface Props {
  active: ActiveMerge
  available: boolean
  reason: string | null
  onEdit: (next: string) => void
  onRegenerate: () => void
  onApply: () => void
  onCancel: () => void
}

export function MergeView({
  active,
  available,
  reason,
  onEdit,
  onRegenerate,
  onApply,
  onCancel,
}: Props) {
  const { members, proposed, edited, loading, error, cached } = active
  const totalMemberChars = members.reduce((a, m) => a + m.text.length, 0)
  const canApply = !loading && edited.trim().length > 0
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <span>Merge duplication cluster</span>
            <Badge variant="secondary" className="text-[10px] uppercase">AI</Badge>
            {cached && !loading && (
              <Badge variant="outline" className="text-[10px]">cached</Badge>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={onRegenerate}
                disabled={loading || !available}
                title="Discard the current merge and ask the LLM again."
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {members.length} paragraph{members.length === 1 ? '' : 's'}, {totalMemberChars.toLocaleString()} chars total.
            Apply replaces the first paragraph with the merged text and removes the others from the source.
          </p>
          {!available && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{reason ?? 'Sidecar unreachable or OPENAI_API_KEY not set.'}</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>Proposed merge</span>
            {edited !== proposed && !loading && (
              <Badge variant="outline" className="text-[10px]">edited</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Merging…</span>
            </div>
          ) : (
            <>
              <textarea
                className="min-h-[8rem] w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                value={edited}
                onChange={e => onEdit(e.target.value)}
                spellCheck={false}
              />
              {active.reason && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Reasoning:</span> {active.reason}
                </p>
              )}
            </>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={onApply}
              disabled={!canApply}
            >
              <Check className="h-3.5 w-3.5" />
              Apply merge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Original paragraphs</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {members.map((m, i) => (
              <li key={m.id} className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    [{i + 1}]
                  </Badge>
                  {m.section && (
                    <Badge variant="outline" className="text-[10px]">
                      {m.section}
                    </Badge>
                  )}
                  <span className="font-mono">{m.text.length} chars</span>
                  <span className="font-mono">@{m.startOffset}</span>
                </div>
                <pre className="whitespace-pre-wrap font-mono leading-relaxed">
                  {m.text}
                </pre>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
