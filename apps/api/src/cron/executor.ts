import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { cronJobLogs } from '@/db/schema'
import { logger } from '@/logger'
import { getActionHandler } from './actions'

export interface TaskConfig {
  action: string
  [key: string]: unknown
}

export async function executeTask(
  jobId: string,
  jobName: string,
  taskConfig: TaskConfig,
): Promise<void> {
  const logId = ulid()
  const startedAt = new Date()

  // Insert running log entry
  db.insert(cronJobLogs).values({
    id: logId,
    jobId,
    startedAt,
    status: 'running',
  }).run()

  try {
    const handler = getActionHandler(taskConfig.action)
    if (!handler) {
      throw new Error(`Unknown action: ${taskConfig.action}`)
    }

    const result = await handler(taskConfig)

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    db.update(cronJobLogs)
      .set({ status: 'success', result, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.debug({ jobName, durationMs, result }, 'cron_job_success')
  } catch (err) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const error = err instanceof Error ? err.message : String(err)

    db.update(cronJobLogs)
      .set({ status: 'failed', error, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.error({ jobName, durationMs, err }, 'cron_job_failed')
  }
}
