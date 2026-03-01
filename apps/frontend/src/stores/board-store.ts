import { move } from '@dnd-kit/helpers'
import type { DragDropProvider } from '@dnd-kit/react'
import { create } from 'zustand'
import { STATUSES } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'

type DragOverEvent = Parameters<
  NonNullable<Parameters<typeof DragDropProvider>[0]['onDragOver']>
>[0]
type DragEndEvent = Parameters<
  NonNullable<Parameters<typeof DragDropProvider>[0]['onDragEnd']>
>[0]

interface BoardState {
  groupedItems: Record<string, Issue[]>
  isDragging: boolean

  syncFromServer: (issues: Issue[]) => void
  applyDragOver: (event: DragOverEvent) => void
  applyDragEnd: (
    event: DragEndEvent,
  ) => Array<{ id: string; statusId: string; sortOrder: number }>
  resetDragging: () => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  groupedItems: {},
  isDragging: false,

  syncFromServer: (issues) => {
    if (get().isDragging) return
    const groups: Record<string, Issue[]> = {}
    for (const status of STATUSES) {
      groups[status.id] = issues
        .filter((i) => i.statusId === status.id)
        .sort((a, b) => {
          // Primary: sortOrder ASC (preserves drag reorder)
          const orderDiff = a.sortOrder - b.sortOrder
          if (orderDiff !== 0) return orderDiff
          // Tiebreaker: statusUpdatedAt DESC (most recent first)
          return (
            new Date(b.statusUpdatedAt).getTime() -
            new Date(a.statusUpdatedAt).getTime()
          )
        })
    }
    set({ groupedItems: groups })
  },

  applyDragOver: (event) => {
    const next = move(get().groupedItems, event)
    set({ groupedItems: next, isDragging: true })
  },

  applyDragEnd: (event) => {
    const current = get().groupedItems
    const updated = move(current, event)
    set({ groupedItems: updated })

    const updates: Array<{
      id: string
      statusId: string
      sortOrder: number
    }> = []
    for (const [statusId, items] of Object.entries(updated)) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.statusId !== statusId || item.sortOrder !== i) {
          updates.push({ id: item.id, statusId, sortOrder: i })
        }
      }
    }

    return updates
  },

  resetDragging: () => {
    set({ isDragging: false })
  },
}))
