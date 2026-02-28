import { create } from 'zustand'
import { move } from '@dnd-kit/helpers'
import type { DragDropProvider } from '@dnd-kit/react'
import type { Issue } from '@/types/kanban'
import { STATUSES } from '@/lib/statuses'

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
        .sort((a, b) => a.sortOrder - b.sortOrder)
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
