import { and, eq } from 'drizzle-orm'
import Baker from 'cronbake'
import { db } from '@/db'
import { cronJobs } from '@/db/schema'
import { logger } from '@/logger'
import type { TaskConfig } from './executor'
import { executeTask } from './executor'
import { getBuiltinNames } from './registry'
import { runWorktreeCleanup } from './tasks/worktree-cleanup'

/** Builtin job definitions: name → { cron, taskConfig } */
const BUILTIN_JOBS: Record<string, { cron: string, taskConfig: TaskConfig }> = {
  'upload-cleanup': {
    cron: '0 0 * * * *', // every hour
    taskConfig: { handler: 'upload-cleanup' },
  },
  'worktree-cleanup': {
    cron: '0 */30 * * * *', // every 30 minutes
    taskConfig: { handler: 'worktree-cleanup' },
  },
  'log-cleanup': {
    cron: '0 0 3 * * *', // daily at 3 AM
    taskConfig: { handler: 'log-cleanup' },
  },
}

let baker: Baker | null = null

export function getBaker(): Baker {
  if (!baker) throw new Error('Cron scheduler not initialized')
  return baker
}

/** Ensure builtin jobs exist in DB (insert if missing) */
function ensureBuiltinJobs(): void {
  for (const name of getBuiltinNames()) {
    const def = BUILTIN_JOBS[name]
    if (!def) continue

    const [existing] = db
      .select({ id: cronJobs.id })
      .from(cronJobs)
      .where(and(eq(cronJobs.name, name), eq(cronJobs.isDeleted, 0)))
      .all()

    if (!existing) {
      db.insert(cronJobs).values({
        name,
        cron: def.cron,
        taskType: 'builtin',
        taskConfig: JSON.stringify(def.taskConfig),
        enabled: true,
      }).run()
      logger.info({ name }, 'cron_builtin_job_created')
    }
  }
}

/** Register a single DB job row into Baker */
function registerJob(
  b: Baker,
  row: typeof cronJobs.$inferSelect,
): void {
  const config: TaskConfig = JSON.parse(row.taskConfig)

  b.add({
    name: row.name,
    cron: row.cron as any,
    overrunProtection: true,
    callback: async () => {
      await executeTask(row.id, row.name, row.taskType, config)
    },
    onError: (error: Error) => {
      logger.error({ jobName: row.name, err: error }, 'cron_job_callback_error')
    },
  })
}

/** Load all enabled jobs from DB and register in Baker */
function loadJobsFromDb(b: Baker): number {
  const rows = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.enabled, true), eq(cronJobs.isDeleted, 0)))
    .all()

  for (const row of rows) {
    try {
      registerJob(b, row)
    } catch (err) {
      logger.error({ jobName: row.name, err }, 'cron_job_register_failed')
    }
  }

  return rows.length
}

/** Sync a single job: add/update/remove from Baker based on DB state */
export function syncJob(name: string): void {
  const b = getBaker()

  // Remove from Baker if it exists
  try {
    b.remove(name)
  } catch {
    // Job didn't exist in Baker, that's fine
  }

  // Re-read from DB
  const [row] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.name, name), eq(cronJobs.isDeleted, 0)))
    .all()

  if (row && row.enabled) {
    registerJob(b, row)
    b.bake(name)
    logger.info({ name }, 'cron_job_synced')
  }
}

/** Initialize and start the cron scheduler */
export function startCron(): () => void {
  baker = Baker.create({
    enableMetrics: true,
    onError: (error, jobName) => {
      logger.error({ jobName, err: error }, 'cron_global_error')
    },
  })

  // Ensure builtin jobs exist in DB
  ensureBuiltinJobs()

  // Load all enabled jobs
  const count = loadJobsFromDb(baker)

  // Start all jobs
  baker.bakeAll()

  // Run worktree cleanup once immediately on startup (matches old startWorktreeCleanup behavior)
  void runWorktreeCleanup().catch((err) => {
    logger.error({ err }, 'worktree_cleanup_startup_error')
  })

  logger.info({ jobCount: count }, 'cron_scheduler_started')

  // Return stop function
  return () => {
    if (baker) {
      baker.stopAll()
      baker.destroyAll()
      baker = null
      logger.info('cron_scheduler_stopped')
    }
  }
}
