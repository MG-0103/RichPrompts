import { useState } from 'react'
import { Eye, EyeOff, Sparkles, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface Props {
  apiKey: string
  setApiKey: (k: string) => void
  loading: boolean
  output: string
  error: string | null
  onReview: () => void
}

export function LLMReviewView({ apiKey, setApiKey, loading, output, error, onReview }: Props) {
  const [showKey, setShowKey] = useState(false)
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>
            <span>LLM Review</span>
            <Badge variant="outline" className="text-[10px]">Tier 3 · subjective</Badge>
            <div className="ml-auto">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={onReview}
                disabled={loading || !apiKey}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {loading ? 'Reviewing…' : 'Run review'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-… (stored in localStorage; sent only to api.anthropic.com)"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="flex-1 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowKey(s => !s)}
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {output && (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">
              {output}
            </pre>
          )}
          {!output && !error && !loading && (
            <p className="text-xs text-muted-foreground">
              Optional. LLM reviews are subjective; treat output as suggestions, not truth.
              Direct browser calls to Anthropic API — your key stays in this browser.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
