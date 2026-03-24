import { and, desc, eq, lt } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { getAction, getActionsHelp, validateActionConfig } from '@/cron/actions'
import { executeTask } from '@/cron/executor'
import { getBaker, syncJob } from '@/cron/index'
import { serializeJob } from '@/cron/serialize'
import { logger } from '@/logger'
import type { TaskConfig } from '@/cron/executor'

const cronRoute = createOpenAPIRouter()

/** Find a non-deleted job by ID or name */
function findJob(identifier: string) {
  const [byId] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, 0), eq(cronJobs.id, identifier)))
    .all()
  if (byId) return byId

  const [byName] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, 0), eq(cronJobs.name, identifier)))
    .all()
  return byName ?? null
}

// GET /api/cron/actions — list available cron actions (must be before /:param routes)
cronRoute.openapi(R.listCronActions, (c) => {
  return c.json({ success: true, data: { help: getActionsHelp() } })
})

// GET /api/cron — list cron jobs with optional pagination and deletion filter
cronRoute.openapi(R.listCronJobs, (c) => {
  const { deleted, limit, cursor } = c.req.valid('query')

  // No pagination requested — return all (backward compatible)
  if (!limit && !cursor) {
    const rows = db
      .select()
      .from(cronJobs)
      .orderBy(desc(cronJobs.createdAt))
      .all()

    const filtered = deleted === 'only'
      ? rows.filter(r => r.isDeleted === 1)
      : deleted === 'false'
        ? rows.filter(r => r.isDeleted === 0)
        : rows

    return c.json({ success: true, data: filtered.map(serializeJob) })
  }

  // Paginated mode
  const pageLimit = limit ?? 20
  const conditions: ReturnType<typeof eq>[] = []

  if (deleted === 'only') {
    conditions.push(eq(cronJobs.isDeleted, 1))
  } else if (deleted === 'false' || !deleted) {
    conditions.push(eq(cronJobs.isDeleted, 0))
  }
  // deleted === 'true' means include all, no filter

  if (cursor) {
    conditions.push(lt(cronJobs.id, cursor))
  }

  const rows = db
    .select()
    .from(cronJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(cronJobs.createdAt))
    .limit(pageLimit + 1)
    .all()

  const hasMore = rows.length > pageLimit
  const page = hasMore ? rows.slice(0, pageLimit) : rows
  const nextCursor = hasMore ? page.at(-1)!.id : null

  return c.json({
    success: true,
    data: {
      jobs: page.map(serializeJob),
      hasMore,
      nextCursor,
    },
  })
})

// POST /api/cron — create a new cron job
cronRoute.openapi(R.createCronJob, async (c) => {
  const { name, cron, action, config: rawConfig } = c.req.valid('json')

  // Check name uniqueness
  if (findJob(name)) {
    return c.json({ success: false, error: `Job with name "${name}" already exists` }, 409 as const)
  }

  // Validate cron expression
  try {
    const { Cron } = await import('cronbake')
    if (!Cron.isValid(cron as any)) {
      return c.json({ success: false, error: `Invalid cron expression: ${cron}` }, 400 as const)
    }
  } catch {
    return c.json({ success: false, error: `Invalid cron expression: ${cron}` }, 400 as const)
  }

  // Build and validate task config
  const taskConfig: TaskConfig = { ...(rawConfig ?? {}), action }
  const validationError = await validateActionConfig(action, taskConfig)
  if (validationError) {
    return c.json({ success: false, error: validationError }, 400 as const)
  }

  const actionDef = getAction(action)
  let row: typeof cronJobs.$inferSelect
  try {
    ;[row] = db.insert(cronJobs).values({
      name,
      cron,
      taskType: actionDef?.category ?? 'custom',
      taskConfig: JSON.stringify(taskConfig),
      enabled: true,
    }).returning().all()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: `Job with name "${name}" already exists` }, 409 as const)
    }
    throw err
  }

  syncJob(name)
  logger.info({ name, cron, action }, 'cron_job_created')
  return c.json({ success: true, data: serializeJob(row) }, 201 as const)
})

// DELETE /api/cron/:jobId — soft-delete a cron job (by ID or name)
cronRoute.openapi(R.deleteCronJob, (c) => {
  const jobId = c.req.param('jobId')
  const row = findJob(jobId)
  if (!row) {
    return c.json({ success: false, error: 'Job not found' }, 404 as const)
  }

  db.update(cronJobs)
    .set({ isDeleted: 1 })
    .where(eq(cronJobs.id, row.id))
    .run()

  try {
    const b = getBaker()
    b.stop(row.name)
    b.remove(row.name)
  } catch {
    // Job may not be in Baker
  }

  logger.info({ name: row.name }, 'cron_job_deleted')
  return c.json({ success: true, data: { deleted: true, name: row.name } }, 200 as const)
})

// GET /api/cron/:jobId/logs — get logs for a specific job
cronRoute.openapi(R.getCronJobLogs, (c) => {
  const jobId = c.req.param('jobId')
  const { status, limit, cursor } = c.req.valid('query')

  // Verify job exists (including soft-deleted — allow viewing logs for deleted jobs)
  const [job] = db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.id, jobId))
    .all()

  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404 as const)
  }

  const pageLimit = limit ?? 20
  const conditions = [eq(cronJobLogs.jobId, jobId)]

  if (status) {
    conditions.push(eq(cronJobLogs.status, status))
  }

  if (cursor) {
    conditions.push(lt(cronJobLogs.id, cursor))
  }

  const logs = db
    .select()
    .from(cronJobLogs)
    .where(and(...conditions))
    .orderBy(desc(cronJobLogs.id))
    .limit(pageLimit + 1)
    .all()

  const hasMore = logs.length > pageLimit
  const page = hasMore ? logs.slice(0, pageLimit) : logs
  const nextCursor = hasMore ? page.at(-1)!.id : null

  return c.json({
    success: true,
    data: {
      jobName: job.name,
      logs: page.map(log => ({
        id: log.id,
        startedAt: log.startedAt.toISOString(),
        finishedAt: log.finishedAt ? log.finishedAt.toISOString() : null,
        durationMs: log.durationMs,
        status: log.status,
        result: log.result,
        error: log.error,
      })),
      hasMore,
      nextCursor,
    },
  }, 200 as const)
})

// POST /api/cron/:jobId/trigger — manually trigger a cron job
cronRoute.openapi(R.triggerCronJob, async (c) => {
  const jobId = c.req.param('jobId')
  const row = findJob(jobId)
  if (!row) {
    return c.json({ success: false, error: 'Job not found' }, 404 as const)
  }

  // Check overrun protection
  try {
    const b = getBaker()
    const status = b.getStatus(row.name)
    if (status === 'running') {
      return c.json({ success: false, error: `Job "${row.name}" is already running` }, 409 as const)
    }
  } catch {
    // Job not in Baker, proceed
  }

  let config: TaskConfig
  try {
    config = JSON.parse(row.taskConfig)
  } catch {
    return c.json({ success: false, error: `Job "${row.name}" has corrupt taskConfig` }, 500 as const)
  }

  const logId = await executeTask(row.id, row.name, config)

  const [log] = db
    .select()
    .from(cronJobLogs)
    .where(eq(cronJobLogs.id, logId))
    .all()

  return c.json({
    success: true,
    data: {
      triggered: true,
      name: row.name,
      log: log
        ? { status: log.status, durationMs: log.durationMs, result: log.result, error: log.error }
        : null,
    },
  }, 200 as const)
})

// POST /api/cron/:jobId/pause — pause a cron job
cronRoute.openapi(R.pauseCronJob, (c) => {
  const jobId = c.req.param('jobId')
  const row = findJob(jobId)
  if (!row) {
    return c.json({ success: false, error: 'Job not found' }, 404 as const)
  }

  db.update(cronJobs)
    .set({ enabled: false })
    .where(eq(cronJobs.id, row.id))
    .run()

  try {
    getBaker().pause(row.name)
  } catch {
    // Job may not be in Baker
  }

  return c.json({ success: true, data: { paused: true, name: row.name } }, 200 as const)
})

// POST /api/cron/:jobId/resume — resume a paused cron job
cronRoute.openapi(R.resumeCronJob, (c) => {
  const jobId = c.req.param('jobId')
  const row = findJob(jobId)
  if (!row) {
    return c.json({ success: false, error: 'Job not found' }, 404 as const)
  }

  db.update(cronJobs)
    .set({ enabled: true })
    .where(eq(cronJobs.id, row.id))
    .run()

  syncJob(row.name)

  return c.json({ success: true, data: { resumed: true, name: row.name } }, 200 as const)
})

export default cronRoute
