import { generateKeyBetween } from 'jittered-fractional-indexing'
import { create } from 'zustand'
import { STATUSES } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'

interface BoardState {
  groupedItems: Record<string, Issue[]>
  isDragging: boolean

  syncFromServer: (issues: Issue[]) => void
  startDragging: () => void
  commitDrag: (args: {
    cardId: string
    toColumnId: string
    toIndex: number
  }) => Array<{ id: string, statusId: string, sortOrder: string }>
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
        .filter(i => i.statusId === status.id)
        .sort((a, b) => {
          // Primary: sortOrder ASC — use plain comparison to match fractional-indexing's
          // character-code ordering (0-9 A-Z a-z). localeCompare can break this.
          const aKey = a.sortOrder || 'a0'
          const bKey = b.sortOrder || 'a0'
          if (aKey < bKey) return -1
          if (aKey > bKey) return 1
          // Tiebreaker: statusUpdatedAt DESC (most recently changed first)
          return new Date(b.statusUpdatedAt).getTime() - new Date(a.statusUpdatedAt).getTime()
        })
    }
    set({ groupedItems: groups })
  },

  startDragging: () => {
    set({ isDragging: true })
  },

  commitDrag: ({ cardId, toColumnId, toIndex }) => {
    const current = get().groupedItems

    // Find which column the card is currently in
    let fromColumnId: string | null = null
    let fromIndex = -1
    for (const [colId, items] of Object.entries(current)) {
      const idx = items.findIndex(i => i.id === cardId)
      if (idx !== -1) {
        fromColumnId = colId
        fromIndex = idx
        break
      }
    }
    if (fromColumnId === null) return []

    // No-op: same column, same position
    if (fromColumnId === toColumnId && fromIndex === toIndex) return []
    // No-op: same column, dropping right below current position
    if (fromColumnId === toColumnId && fromIndex + 1 === toIndex) return []

    // Build the target column's item list with the card inserted
    const sourceItems = [...(current[fromColumnId] ?? [])]
    const [moved] = sourceItems.splice(fromIndex, 1)
    if (!moved) return []

    const destItems = fromColumnId === toColumnId
      ? sourceItems
      : [...(current[toColumnId] ?? [])]

    // Adjust index when moving within same column downward
    const adjustedIndex = fromColumnId === toColumnId && fromIndex < toIndex
      ? toIndex - 1
      : toIndex
    const clampedIndex = Math.min(adjustedIndex, destItems.length)
    destItems.splice(clampedIndex, 0, moved)

    // Update grouped items optimistically
    const next = { ...current, [fromColumnId]: sourceItems }
    if (fromColumnId !== toColumnId) {
      next[toColumnId] = destItems
    } else {
      next[fromColumnId] = destItems
    }
    set({ groupedItems: next })

    // Compute fractional sort order from neighbors
    const prevKey = clampedIndex > 0 ? (destItems[clampedIndex - 1]!.sortOrder || null) : null
    const afterKey = clampedIndex < destItems.length - 1 ? (destItems[clampedIndex + 1]!.sortOrder || null) : null

    // Happy path: neighbors have distinct, properly ordered sortOrders
    if (prevKey === null || afterKey === null || prevKey < afterKey) {
      const newKey = generateKeyBetween(prevKey, afterKey)
      return [{ id: cardId, statusId: toColumnId, sortOrder: newKey }]
    }

    // Collision: adjacent sortOrders are equal or out of order (e.g. all 'a0').
    // Reassign sequential sortOrders to the entire column to establish order.
    const updates: Array<{ id: string, statusId: string, sortOrder: string }> = []
    let cursor: string | null = null
    for (const item of destItems) {
      const key = generateKeyBetween(cursor, null)
      cursor = key
      updates.push({ id: item.id, statusId: toColumnId, sortOrder: key })
    }
    return updates
  },

  resetDragging: () => {
    set({ isDragging: false })
  },
}))
