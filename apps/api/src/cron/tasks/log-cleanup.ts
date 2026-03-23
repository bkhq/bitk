import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { logger } from '@/logger'

/** Keep only the latest N logs per job */
const MAX_LOGS_PER_JOB = 1000

export async function runLogCleanup(): Promise<string> {
  const jobs = db
    .select({ id: cronJobs.id })
    .from(cronJobs)
    .where(eq(cronJobs.isDeleted, 0))
    .all()

  let totalDeleted = 0

  for (const job of jobs) {
    // Get the ID of the Nth newest log for this job
    const keepIds = db
      .select({ id: cronJobLogs.id })
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id))
      .orderBy(sql`${cronJobLogs.id} DESC`)
      .limit(MAX_LOGS_PER_JOB)
      .all()
      .map(r => r.id)

    if (keepIds.length < MAX_LOGS_PER_JOB) continue

    // Count before delete
    const [{ count: beforeCount }] = db
      .select({ count: sql<number>`count(*)` })
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id))
      .all()

    // Delete logs older than the Nth newest
    const oldest = keepIds.at(-1)!
    db.delete(cronJobLogs)
      .where(
        and(
          eq(cronJobLogs.jobId, job.id),
          sql`${cronJobLogs.id} < ${oldest}`,
        ),
      )
      .run()

    totalDeleted += beforeCount - MAX_LOGS_PER_JOB
  }

  if (totalDeleted > 0) {
    logger.info({ deleted: totalDeleted }, 'cron_log_cleanup_done')
  }
  return `deleted ${totalDeleted} old log entries`
}
