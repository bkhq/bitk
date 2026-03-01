import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition } from '@/lib/statuses'
import { usePanelStore } from '@/stores/panel-store'
import type { Issue } from '@/types/kanban'
import { KanbanCard } from './KanbanCard'

export function KanbanColumn({
  status,
  issues,
  selectedIssueId,
  onCardClick,
}: {
  status: StatusDefinition
  issues: Issue[]
  selectedIssueId?: string | null
  onCardClick?: (issue: Issue) => void
}) {
  const { t } = useTranslation()
  const openCreateDialog = usePanelStore((s) => s.openCreateDialog)

  const { ref, isDropTarget } = useDroppable({
    id: status.id,
    collisionPriority: CollisionPriority.Normal,
  })

  const sorted = [...issues].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div
      className={`flex h-full min-w-[85vw] md:min-w-[260px] flex-1 flex-col rounded-lg border snap-center md:snap-align-none transition-colors duration-200 ${
        isDropTarget
          ? 'ring-2 ring-primary/30 bg-primary/[0.04] border-primary/20'
          : 'bg-muted/40'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        <span className="text-sm font-medium text-foreground">
          {tStatus(t, status.name)}
        </span>
        <Badge
          variant="secondary"
          className="h-5 min-w-5 px-1.5 text-[10px] font-medium"
        >
          {sorted.length}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 text-muted-foreground"
          onClick={() => openCreateDialog(status.id)}
          aria-label={t('kanban.createIssueIn', { name: status.name })}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      {/* Cards */}
      <div
        ref={ref}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5"
      >
        {sorted.map((issue, index) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            index={index}
            columnStatusId={status.id}
            isSelected={selectedIssueId === issue.id}
            onCardClick={onCardClick}
          />
        ))}
        {/* Spacer extends the droppable zone to the bottom of the column */}
        <div className="min-h-[40px] flex-grow" />
      </div>
    </div>
  )
}
