import { move } from '@dnd-kit/helpers'
import type { DragDropProvider } from '@dnd-kit/react'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { create } from 'zustand'
import { STATUSES } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'

type DragOverEvent = Parameters<
  NonNullable<Parameters<typeof DragDropProvider>[0]['onDragOver']>
>[0]
type DragEndEvent = Parameters<NonNullable<Parameters<typeof DragDropProvider>[0]['onDragEnd']>>[0]

interface BoardState {
  groupedItems: Record<string, Issue[]>
  preDragItems: Record<string, Issue[]> | null
  isDragging: boolean

  syncFromServer: (issues: Issue[]) => void
  applyDragOver: (event: DragOverEvent) => void
  applyDragEnd: (event: DragEndEvent) => Array<{ id: string, statusId: string, sortOrder: string }>
  resetDragging: () => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  groupedItems: {},
  preDragItems: null,
  isDragging: false,

  syncFromServer: (issues) => {
    if (get().isDragging) return
    const groups: Record<string, Issue[]> = {}
    for (const status of STATUSES) {
      groups[status.id] = issues
        .filter(i => i.statusId === status.id)
        .sort((a, b) => {
          // Primary: statusUpdatedAt DESC (most recently changed first)
          const timeDiff =
            new Date(b.statusUpdatedAt).getTime() - new Date(a.statusUpdatedAt).getTime()
          if (timeDiff !== 0) return timeDiff
          // Tiebreaker: sortOrder ASC (preserves drag reorder)
          return a.sortOrder.localeCompare(b.sortOrder)
        })
    }
    set({ groupedItems: groups })
  },

  applyDragOver: (event) => {
    const state = get()
    const preDragItems = state.preDragItems ?? state.groupedItems
    const next = move(state.groupedItems, event)
    set({ groupedItems: next, preDragItems, isDragging: true })
  },

  applyDragEnd: (event) => {
    const current = get().groupedItems
    const updated = move(current, event)
    set({ groupedItems: updated })

    // Find the dragged item via the event source
    const op = event.operation as any
    const draggedId: string | undefined =
      op.dragOperation?.source?.data?.issue?.id
      ?? op.source?.data?.issue?.id

    if (!draggedId) return []

    // Find the dragged item's new position across all columns
    for (const [statusId, items] of Object.entries(updated)) {
      const idx = items.findIndex(i => i.id === draggedId)
      if (idx === -1) continue

      const item = items[idx]!

      // Skip if item didn't actually move (compare against pre-drag snapshot)
      const preDrag = get().preDragItems ?? current
      const oldItems = preDrag[item.statusId] ?? []
      const oldIdx = oldItems.findIndex(i => i.id === draggedId)
      if (item.statusId === statusId && oldIdx === idx) return []

      const prev = idx > 0 ? items[idx - 1]!.sortOrder : null
      const next = idx < items.length - 1 ? items[idx + 1]!.sortOrder : null
      const newKey = generateKeyBetween(prev, next)

      return [{ id: draggedId, statusId, sortOrder: newKey }]
    }

    return []
  },

  resetDragging: () => {
    set({ isDragging: false, preDragItems: null })
  },
}))
