import { memo } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { GitBranchPlus } from 'lucide-react'
import type { Issue } from '@/types/kanban'
import { PriorityIcon } from './PriorityIcon'

export const KanbanCard = memo(function KanbanCard({
  issue,
  index,
  columnStatusId,
  isSelected,
  onCardClick,
}: {
  issue: Issue
  index: number
  columnStatusId: string
  isSelected?: boolean
  onCardClick?: (issue: Issue) => void
}) {
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
      {/* Top row: ID + Priority */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground font-mono">
          #{issue.issueNumber}
        </span>
        <PriorityIcon priority={issue.priority} />
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
