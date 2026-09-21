import { MoreHorizontal, FlaskConical, BookMarked, Settings, Sun, Moon, LayoutTemplate } from 'lucide-react'
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
import { WORKSPACE_VIEWS, type ActiveView, type WorkspaceView } from './views'
import type { Theme } from './useTheme'

const WORKSPACE_ICONS: Record<WorkspaceView, typeof FlaskConical> = {
  tests: FlaskConical,
  registry: BookMarked,
  settings: Settings,
}

interface Props {
  active: ActiveView
  onOpenWorkbench: () => void
  onOpenWorkspace: (view: WorkspaceView) => void
  theme: Theme
  onToggleTheme: () => void
}

export function TopNavbar({
  active,
  onOpenWorkbench,
  onOpenWorkspace,
  theme,
  onToggleTheme,
}: Props) {
  const inWorkbench = active.scope === 'workbench'
  const currentWorkspace = active.scope === 'workspace' ? active.view : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="text-sm font-semibold tracking-tight">RichPrompt</span>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <Button
        variant={inWorkbench ? 'secondary' : 'ghost'}
        size="sm"
        className={cn('h-8 gap-1.5 text-sm', !inWorkbench && 'text-muted-foreground')}
        onClick={onOpenWorkbench}
      >
        <LayoutTemplate className="h-4 w-4" />
        Workbench
      </Button>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        {WORKSPACE_VIEWS.map(v => {
          const Icon = WORKSPACE_ICONS[v.key]
          return (
            <Button
              key={v.key}
              variant={currentWorkspace === v.key ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              title={v.label}
              onClick={() => onOpenWorkspace(v.key)}
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
              <DropdownMenuItem key={v.key} onSelect={() => onOpenWorkspace(v.key)}>
                {v.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
