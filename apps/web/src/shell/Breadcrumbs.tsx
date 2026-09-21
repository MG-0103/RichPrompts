import { ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface Crumb {
  label: string
  onSelect?: () => void
}

interface Props {
  crumbs: Crumb[]
  canGoBack: boolean
  onBack: () => void
}

export function Breadcrumbs({ crumbs, canGoBack, onBack }: Props) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background/60 px-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onBack}
        disabled={!canGoBack}
        title="Back"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <nav className="flex items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
              {c.onSelect && !isLast ? (
                <button
                  onClick={c.onSelect}
                  className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                >
                  {c.label}
                </button>
              ) : (
                <span className={isLast ? 'font-medium text-foreground' : ''}>{c.label}</span>
              )}
            </span>
          )
        })}
      </nav>
    </div>
  )
}
