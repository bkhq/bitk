import { Hono } from 'hono'
import { and, desc, eq, lt } from 'drizzle-orm'
import * as z from 'zod'
import { zValidator } from '@hono/zod-validator'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { serializeJob } from '@/cron/serialize'

const cronRoute = new Hono()

const logsQuerySchema = z.object({
  status: z.enum(['success', 'failed', 'running']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

// GET /api/cron — list all cron jobs (including soft-deleted)
cronRoute.get('/', (c) => {
  const rows = db
    .select()
    .from(cronJobs)
    .all()

  return c.json({ success: true, data: rows.map(serializeJob) })
})

// GET /api/cron/:jobId/logs — get logs for a specific job
cronRoute.get('/:jobId/logs', zValidator('query', logsQuerySchema), (c) => {
  const jobId = c.req.param('jobId')
  const { status, limit, cursor } = c.req.valid('query')

  // Verify job exists (including soft-deleted — allow viewing logs for deleted jobs)
  const [job] = db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.id, jobId))
    .all()

  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404)
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
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        durationMs: log.durationMs,
        status: log.status,
        result: log.result,
        error: log.error,
      })),
      hasMore,
      nextCursor,
    },
  })
})

export default cronRoute
