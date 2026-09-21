import { useMemo } from 'react'
import { AlertCircle, Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { longestCommonSubstring, sharedPhrases } from '@richprompt/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ActiveMerge } from '@/hooks/useClusterMerge'

const MIN_LCS_HIGHLIGHT = 15
const MAX_LCS_STRINGS = 8

function computeSharedStrings(texts: string[]): string[] {
  if (texts.length < 2) return []
  const raw = new Set<string>()
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const lcs = longestCommonSubstring(texts[i], texts[j]).trim()
      if (lcs.length >= MIN_LCS_HIGHLIGHT) raw.add(lcs)
    }
  }
  for (const ng of sharedPhrases(texts)) {
    if (ng.trim().length > 0) raw.add(ng.trim())
  }
  const sorted = Array.from(raw).sort((a, b) => b.length - a.length)
  const kept: string[] = []
  for (const s of sorted) {
    if (kept.some(k => k.toLowerCase().includes(s.toLowerCase()))) continue
    kept.push(s)
    if (kept.length >= MAX_LCS_STRINGS) break
  }
  return kept
}

interface Segment {
  text: string
  shared: boolean
}

function segment(text: string, shared: string[]): Segment[] {
  if (shared.length === 0 || text.length === 0) return [{ text, shared: false }]
  const lower = text.toLowerCase()
  const hits: { start: number; end: number }[] = []
  for (const s of shared) {
    const lo = s.toLowerCase()
    let from = 0
    while (from <= lower.length - lo.length) {
      const idx = lower.indexOf(lo, from)
      if (idx === -1) break
      hits.push({ start: idx, end: idx + lo.length })
      from = idx + Math.max(1, lo.length)
    }
  }
  if (hits.length === 0) return [{ text, shared: false }]
  hits.sort((a, b) => (a.start - b.start) || (b.end - b.start) - (a.end - a.start))
  const accepted: { start: number; end: number }[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start < cursor) continue
    accepted.push(h)
    cursor = h.end
  }
  const out: Segment[] = []
  let pos = 0
  for (const h of accepted) {
    if (h.start > pos) out.push({ text: text.slice(pos, h.start), shared: false })
    out.push({ text: text.slice(h.start, h.end), shared: true })
    pos = h.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos), shared: false })
  return out
}

function DiffText({ text, shared }: { text: string; shared: string[] }) {
  const segs = useMemo(() => segment(text, shared), [text, shared])
  return (
    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
      {segs.map((s, i) => (
        <span
          key={i}
          className={cn(
            s.shared &&
              'rounded-sm bg-emerald-500/25 px-0.5 text-emerald-900 dark:bg-emerald-400/25 dark:text-emerald-50',
          )}
        >
          {s.text}
        </span>
      ))}
    </pre>
  )
}

/**
 * Left column: originals with their shared spans highlighted. Reads
 * top-down like the editor did before, one card per cluster member.
 * When members is empty (stale-cache error case), renders nothing —
 * the error banner in the right column carries the message.
 */
export function MergeDiffPanel({ active }: { active: ActiveMerge }) {
  const { members } = active
  const sharedStrings = useMemo(
    () => computeSharedStrings(members.map(m => m.text)),
    [members],
  )
  if (members.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        No paragraphs to diff — see the error on the right.
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Originals</span>
        <span className="font-mono">{members.length} paragraphs</span>
        {sharedStrings.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/60 align-middle" />
            shared across ≥ 2
          </span>
        )}
      </div>
      <ul className="space-y-3">
        {members.map((m, i) => (
          <li key={m.id} className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">[{i + 1}]</Badge>
              {m.section && <Badge variant="outline" className="text-[10px]">{m.section}</Badge>}
              <span className="font-mono">{m.text.length} chars</span>
              <span className="font-mono">@{m.startOffset}</span>
            </div>
            <DiffText text={m.text} shared={sharedStrings} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Right column: the LLM's proposal, editable, plus Apply/Cancel and
 * the metadata card that used to sit above.
 */
export function MergeSuggestionPanel({
  active,
  available,
  reason,
  onEdit,
  onRegenerate,
  onApply,
  onCancel,
}: {
  active: ActiveMerge
  available: boolean
  reason: string | null
  onEdit: (next: string) => void
  onRegenerate: () => void
  onApply: () => void
  onCancel: () => void
}) {
  const { members, proposed, edited, loading, error, cached } = active
  const totalMemberChars = members.reduce((a, m) => a + m.text.length, 0)
  const canApply = !loading && edited.trim().length > 0 && members.length >= 2
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-4">
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Merge suggestion</span>
              <Badge variant="secondary" className="text-[10px] uppercase">AI</Badge>
              {cached && !loading && !error && (
                <Badge variant="outline" className="text-[10px]">cached</Badge>
              )}
              {edited !== proposed && !loading && !error && (
                <Badge variant="outline" className="text-[10px]">edited</Badge>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={onRegenerate}
                  disabled={loading || !available || members.length < 2}
                  title="Discard the current merge and ask the LLM again."
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {members.length >= 2 && (
              <p className="text-xs text-muted-foreground">
                {members.length} paragraphs, {totalMemberChars.toLocaleString()} chars total.
                Apply replaces the first paragraph with the merged text and removes the others from the source.
              </p>
            )}
            {!available && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{reason ?? 'Sidecar unreachable or OPENAI_API_KEY not set.'}</span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Merging…</span>
              </div>
            ) : members.length >= 2 && !error ? (
              <>
                <textarea
                  className="min-h-[10rem] w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
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
            ) : null}
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
      </div>
    </div>
  )
}
