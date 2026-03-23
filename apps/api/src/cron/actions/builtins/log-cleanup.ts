import { and, count as countFn, desc, eq, lt } from 'drizzle-orm'
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
      .orderBy(desc(cronJobLogs.id))
      .limit(MAX_LOGS_PER_JOB)
      .all()
      .map(r => r.id)

    if (keepIds.length < MAX_LOGS_PER_JOB) continue

    // Delete logs older than the Nth newest
    const oldest = keepIds.at(-1)!

    // Count rows to delete before deleting (single atomic read in SQLite WAL)
    const [{ cnt }] = db
      .select({ cnt: countFn() })
      .from(cronJobLogs)
      .where(and(eq(cronJobLogs.jobId, job.id), lt(cronJobLogs.id, oldest)))
      .all()

    db.delete(cronJobLogs)
      .where(and(eq(cronJobLogs.jobId, job.id), lt(cronJobLogs.id, oldest)))
      .run()

    totalDeleted += cnt
  }

  if (totalDeleted > 0) {
    logger.info({ deleted: totalDeleted }, 'cron_log_cleanup_done')
  }
  return `deleted ${totalDeleted} old log entries`
}
