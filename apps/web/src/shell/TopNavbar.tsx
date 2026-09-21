import { ChevronDown, MoreHorizontal, FlaskConical, BookMarked, Settings } from 'lucide-react'
import type { DocType } from '@richprompt/core'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  DOC_VIEWS,
  WORKSPACE_VIEWS,
  type ActiveView,
  type DocView,
  type WorkspaceView,
} from './views'

const DOC_LABELS: Record<DocType, string> = {
  prompt: 'Prompt',
  tool: 'Tool',
  skill: 'Skill',
}

const WORKSPACE_ICONS: Record<WorkspaceView, typeof FlaskConical> = {
  tests: FlaskConical,
  registry: BookMarked,
  settings: Settings,
}

interface Props {
  active: ActiveView
  docType: DocType
  onDocTypeChange: (d: DocType) => void
  onSelectDocView: (view: DocView) => void
  onSelectWorkspaceView: (view: WorkspaceView) => void
}

export function TopNavbar({
  active,
  docType,
  onDocTypeChange,
  onSelectDocView,
  onSelectWorkspaceView,
}: Props) {
  const currentDocView = active.scope === 'doc' ? active.view : null
  const currentWorkspaceView = active.scope === 'workspace' ? active.view : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="text-sm font-semibold tracking-tight">RichPrompt</span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 px-2">
            <span className="text-sm">{DOC_LABELS[docType]}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Doc</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(['prompt', 'tool', 'skill'] as DocType[]).map(t => (
            <DropdownMenuItem key={t} onSelect={() => onDocTypeChange(t)}>
              <span className={cn(t === docType && 'font-medium')}>{DOC_LABELS[t]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6" />

      <nav className="flex items-center gap-0.5">
        {DOC_VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => onSelectDocView(v.key)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors',
              currentDocView === v.key
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-0.5">
        {WORKSPACE_VIEWS.map(v => {
          const Icon = WORKSPACE_ICONS[v.key]
          return (
            <Button
              key={v.key}
              variant={currentWorkspaceView === v.key ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              title={v.label}
              onClick={() => onSelectWorkspaceView(v.key)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          )
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="More">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {WORKSPACE_VIEWS.map(v => (
              <DropdownMenuItem key={v.key} onSelect={() => onSelectWorkspaceView(v.key)}>
                {v.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
