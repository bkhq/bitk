import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useViewModeStore } from '@/stores/view-mode-store'

const VIEW_MODES = [
  { id: 'kanban', icon: LayoutGrid },
  { id: 'list', icon: List },
] as const

type ViewModeId = (typeof VIEW_MODES)[number]['id']

/**
 * Dropdown select for switching between kanban / list / review views.
 * - `variant="icon"` (default): compact icon-only button (for sidebar)
 * - `variant="segmented"`: inline segmented control (for HomePage header)
 */
export function ViewModeSelect({
  activeProjectId,
  variant = 'icon',
}: {
  activeProjectId?: string
  variant?: 'icon' | 'segmented'
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { mode, setMode } = useViewModeStore()

  const labels: Record<ViewModeId, string> = {
    kanban: t('viewMode.kanban'),
    list: t('viewMode.list'),
  }

  const handleSelect = (next: ViewModeId) => {
    setMode(next)
    if (activeProjectId) {
      void navigate(
        next === 'list' ? `/projects/${activeProjectId}/issues` : `/projects/${activeProjectId}`,
      )
    }
  }

  if (variant === 'segmented') {
    return (
      <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
        {VIEW_MODES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleSelect(id)}
            className={cn(
              'rounded-sm px-2 py-1 text-xs transition-colors',
              mode === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={labels[id]}
            title={labels[id]}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    )
  }

  const CurrentIcon = VIEW_MODES.find(m => m.id === mode)?.icon ?? LayoutGrid

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer dark:hover:bg-muted/50"
        aria-label={t('viewMode.switchView')}
        title={labels[mode]}
      >
        <CurrentIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="center" className="min-w-[120px]">
        {VIEW_MODES.map(({ id, icon: Icon }) => (
          <DropdownMenuItem
            key={id}
            onClick={() => handleSelect(id)}
            className={cn('gap-2 text-xs', mode === id && 'bg-accent font-medium')}
          >
            <Icon className="h-3.5 w-3.5" />
            {labels[id]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
