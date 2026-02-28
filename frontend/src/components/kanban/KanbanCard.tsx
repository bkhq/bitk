import { memo } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { GitBranchPlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Issue } from '@/types/kanban'
import { PriorityIcon } from './PriorityIcon'

export const KanbanCard = memo(function KanbanCard({
  issue,
  index,
  columnStatusId,
  isSelected,
  onCardClick,
  onDelete,
}: {
  issue: Issue
  index: number
  columnStatusId: string
  isSelected?: boolean
  onCardClick?: (issue: Issue) => void
  onDelete?: (issue: Issue) => void
}) {
  const { t } = useTranslation()
  const { ref, isDragging } = useSortable({
    id: issue.id,
    index,
    group: columnStatusId,
    type: 'item',
    data: { issue },
  })

  return (
    <div
      ref={ref}
      onClick={() => onCardClick?.(issue)}
      className={`group rounded-lg border bg-card px-3 py-2.5 cursor-pointer hover:shadow-sm animate-card-enter ${
        isDragging
          ? 'opacity-50 scale-105 shadow-xl rotate-1 ring-2 ring-primary/30 transition-none'
          : 'transition-all'
      } ${
        isSelected
          ? 'border-primary/50 shadow-sm ring-1 ring-primary/20'
          : 'border-transparent hover:border-border'
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Top row: ID + Priority + Delete */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground font-mono">
          #{issue.issueNumber}
        </span>
        <div className="flex items-center gap-1">
          {onDelete ? (
            <button
              type="button"
              className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={t('issue.delete')}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(issue)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
          <PriorityIcon priority={issue.priority} />
        </div>
      </div>

      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">
        {issue.title}
      </p>

      {/* Sub-issue count badge */}
      {issue.childCount && issue.childCount > 0 ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <GitBranchPlus className="h-3 w-3" />
          <span>{issue.childCount}</span>
        </div>
      ) : null}
    </div>
  )
})
