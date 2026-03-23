import { and, count as countFn, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { logger } from '@/logger'

/** Keep only the latest N logs per job */
const MAX_LOGS_PER_JOB = 1000

export async function runLogCleanup(): Promise<string> {
  // Include all jobs (even soft-deleted) to clean up orphaned logs
  const jobs = db
    .select({ id: cronJobs.id, isDeleted: cronJobs.isDeleted })
    .from(cronJobs)
    .all()

  let totalDeleted = 0

  for (const job of jobs) {
    // For soft-deleted jobs, purge all logs
    if (job.isDeleted) {
      const [{ cnt }] = db
        .select({ cnt: countFn() })
        .from(cronJobLogs)
        .where(eq(cronJobLogs.jobId, job.id))
        .all()

      if (cnt > 0) {
        db.delete(cronJobLogs)
          .where(eq(cronJobLogs.jobId, job.id))
          .run()
        totalDeleted += cnt
      }
      continue
    }

    // For active jobs, keep the latest N logs
    const keepIds = db
      .select({ id: cronJobLogs.id })
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id))
      .orderBy(desc(cronJobLogs.id))
      .limit(MAX_LOGS_PER_JOB)
      .all()
      .map(r => r.id)

    if (keepIds.length < MAX_LOGS_PER_JOB) continue

    const oldest = keepIds.at(-1)!
    const [{ cnt }] = db
      .select({ cnt: countFn() })
      .from(cronJobLogs)
      .where(and(eq(cronJobLogs.jobId, job.id), lt(cronJobLogs.id, oldest)))
      .all()

    if (cnt > 0) {
      db.delete(cronJobLogs)
        .where(and(eq(cronJobLogs.jobId, job.id), lt(cronJobLogs.id, oldest)))
        .run()
      totalDeleted += cnt
    }
  }

  if (totalDeleted > 0) {
    logger.info({ deleted: totalDeleted }, 'cron_log_cleanup_done')
  }
  return `deleted ${totalDeleted} old log entries`
}
