import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useBulkUpdateIssues, useIssues } from '@/hooks/use-kanban'
import { STATUSES } from '@/lib/statuses'
import { useBoardStore } from '@/stores/board-store'
import { useSelectedIssueId } from '@/stores/panel-store'
import type { Issue } from '@/types/kanban'
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

  const { groupedItems, syncFromServer } = useBoardStore()
  const selectedIssueId = useSelectedIssueId()

  // Use refs for values accessed inside monitor callbacks to avoid re-registering
  const bulkUpdateRef = useRef(bulkUpdate)
  bulkUpdateRef.current = bulkUpdate
  const groupedItemsRef = useRef(groupedItems)
  groupedItemsRef.current = groupedItems

  useEffect(() => {
    if (!issues) return
    syncFromServer(issues)
  }, [issues, syncFromServer])

  const handleDrop = useCallback(({ source, location }: { source: any, location: any }) => {
    const targets = location.current.dropTargets
    if (targets.length === 0) {
      useBoardStore.getState().resetDragging()
      return
    }

    const cardId = source.data.cardId as string

    // Find the innermost card target and the column target
    const cardTarget = targets.find((t: any) => t.data.type === 'card')
    const columnTarget = targets.find((t: any) => t.data.type === 'column')

    let toColumnId: string
    let toIndex: number

    if (cardTarget) {
      toColumnId = cardTarget.data.columnId as string
      toIndex = cardTarget.data.index as number
      const edge = extractClosestEdge(cardTarget.data)
      if (edge === 'bottom') toIndex += 1
    } else if (columnTarget) {
      // Dropped on empty area of column — append to end
      toColumnId = columnTarget.data.columnId as string
      toIndex = (groupedItemsRef.current[toColumnId]?.length ?? 0)
    } else {
      useBoardStore.getState().resetDragging()
      return
    }

    const updates = useBoardStore.getState().commitDrag({ cardId, toColumnId, toIndex })
    if (updates.length > 0) {
      bulkUpdateRef.current.mutate(updates)
    } else {
      useBoardStore.getState().resetDragging()
    }
  }, [])

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'card',
      onDragStart: () => {
        useBoardStore.getState().startDragging()
      },
      onDrop: handleDrop,
    })
  }, [handleDrop])

  const issuesByStatus = useMemo(() => {
    const map = new Map<string, Issue[]>()
    const query = searchQuery?.trim().toLowerCase()
    for (const status of STATUSES) {
      let items = groupedItems[status.id] ?? []
      if (query) {
        items = items.filter(
          issue =>
            issue.title.toLowerCase().includes(query)
            || issue.issueNumber.toString().includes(query),
        )
      }
      map.set(status.id, items)
    }
    return map
  }, [groupedItems, searchQuery])

  if (issuesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">{t('kanban.loadingBoard')}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3 snap-x snap-mandatory md:snap-none">
      {STATUSES.map(status => (
        <KanbanColumn
          key={status.id}
          status={status}
          issues={issuesByStatus.get(status.id) ?? []}
          selectedIssueId={selectedIssueId}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  )
}
