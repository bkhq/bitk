import type { cronJobs } from '@/db/schema'
import { getBaker } from './index'

export interface SerializedCronJob {
  id: string
  name: string
  cron: string
  taskType: string
  taskConfig: Record<string, unknown>
  enabled: boolean
  status: string
  nextExecution: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export function serializeJob(row: typeof cronJobs.$inferSelect): SerializedCronJob {
  let status = 'unknown'
  let nextExecution: string | null = null

  try {
    const baker = getBaker()
    status = baker.getStatus(row.name)
    const next = baker.nextExecution(row.name)
    nextExecution = next ? next.toISOString() : null
  } catch {
    status = row.enabled ? 'not_loaded' : 'disabled'
  }

  let taskConfig: Record<string, unknown> = {}
  try {
    taskConfig = JSON.parse(row.taskConfig)
  } catch {
    taskConfig = { _raw: row.taskConfig }
  }

  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    taskType: row.taskType,
    taskConfig,
    enabled: row.enabled,
    status,
    nextExecution,
    isDeleted: row.isDeleted === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
