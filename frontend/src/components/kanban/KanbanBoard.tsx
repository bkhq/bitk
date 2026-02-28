import { DragDropProvider } from '@dnd-kit/react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useBulkUpdateIssues,
  useDeleteIssue,
  useIssues,
} from '@/hooks/use-kanban'
import type { Issue } from '@/types/kanban'
import { useBoardStore } from '@/stores/board-store'
import { useSelectedIssueId } from '@/stores/panel-store'
import { STATUSES } from '@/lib/statuses'
import { KanbanColumn } from './KanbanColumn'

export function KanbanBoard({
  projectId,
  searchQuery,
  onCardClick,
}: {
  projectId: string
  searchQuery?: string
  onCardClick?: (issue: Issue) => void
}) {
  const { t } = useTranslation()
  const { data: issues, isLoading: issuesLoading } = useIssues(projectId)
  const bulkUpdate = useBulkUpdateIssues(projectId)
  const deleteIssue = useDeleteIssue(projectId)

  const { groupedItems, syncFromServer, applyDragOver, applyDragEnd } =
    useBoardStore()
  const selectedIssueId = useSelectedIssueId()

  useEffect(() => {
    if (!issues) return
    syncFromServer(issues)
  }, [issues, syncFromServer])

  const handleDelete = useCallback(
    (issue: Issue) => {
      const message =
        issue.childCount && issue.childCount > 0
          ? `${t('issue.deleteConfirm')}\n\n${t('issue.deleteWithChildren')}`
          : t('issue.deleteConfirm')
      if (window.confirm(message)) {
        deleteIssue.mutate(issue.id)
      }
    },
    [t, deleteIssue],
  )

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, Issue[]>()
    const query = searchQuery?.trim().toLowerCase()
    for (const status of STATUSES) {
      let items = groupedItems[status.id] ?? []
      if (query) {
        items = items.filter(
          (issue) =>
            issue.title.toLowerCase().includes(query) ||
            issue.issueNumber.toString().includes(query),
        )
      }
      map.set(status.id, items)
    }
    return map
  }, [groupedItems, searchQuery])

  if (issuesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">
          {t('kanban.loadingBoard')}
        </div>
      </div>
    )
  }

  return (
    <DragDropProvider
      onDragOver={applyDragOver}
      onDragEnd={(event) => {
        const updates = applyDragEnd(event)
        if (updates.length > 0) {
          bulkUpdate.mutate(updates)
        }
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3 snap-x snap-mandatory md:snap-none">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            issues={issuesByStatus.get(status.id) ?? []}
            selectedIssueId={selectedIssueId}
            onCardClick={onCardClick}
            onDeleteIssue={handleDelete}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}
