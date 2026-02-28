export type StatusId = 'todo' | 'working' | 'review' | 'done'

export interface StatusDefinition {
  id: StatusId
  name: string
  color: string
  sortOrder: number
}

export const STATUSES: StatusDefinition[] = [
  { id: 'todo', name: 'Todo', color: '#6b7280', sortOrder: 0 },
  { id: 'working', name: 'Working', color: '#3b82f6', sortOrder: 1 },
  { id: 'review', name: 'Review', color: '#f59e0b', sortOrder: 2 },
  { id: 'done', name: 'Done', color: '#22c55e', sortOrder: 3 },
]

export const STATUS_MAP = new Map<string, StatusDefinition>(STATUSES.map((s) => [s.id, s]))

export const STATUS_IDS = STATUSES.map((s) => s.id) as [StatusId, ...StatusId[]]

export const DEFAULT_STATUS_ID: StatusId = 'todo'
