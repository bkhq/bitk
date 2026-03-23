import { and, desc, eq, lt } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { logger } from '@/logger'
import { getAction, getActionsHelp, validateActionConfig } from './actions'
import { executeTask } from './executor'
import { getBaker, syncJob } from './index'
import { serializeJob } from './serialize'
import type { TaskConfig } from './executor'

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function findJob(identifier: string) {
  // Try by ID first, then by name
  const [row] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, 0), eq(cronJobs.id, identifier)))
    .all()
  if (row) return row

  const [byName] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.isDeleted, 0), eq(cronJobs.name, identifier)))
    .all()
  return byName ?? null
}

export function registerCronMcpTools(server: McpServer): void {
  // ==================== cron-list ====================

  server.registerTool('cron-list', {
    title: 'List Cron Jobs',
    description: 'List all registered cron jobs with their status, schedule, and next execution time.',
    inputSchema: z.object({
      enabled: z.boolean().optional().describe('Filter by enabled state. Omit to list all.'),
    }),
  }, async ({ enabled }) => {
    const conditions = [eq(cronJobs.isDeleted, 0)]
    if (enabled !== undefined) {
      conditions.push(eq(cronJobs.enabled, enabled))
    }

    const rows = db
      .select()
      .from(cronJobs)
      .where(and(...conditions))
      .all()

    return textResult(rows.map(serializeJob))
  })

  // ==================== cron-create ====================

  server.registerTool('cron-create', {
    title: 'Create Cron Job',
    description: [
      'Create a new scheduled cron job.',
      '',
      'Cron formats:',
      '  - 6-field: "second minute hour dayOfMonth month dayOfWeek"',
      '  - Presets: @every_minute, @hourly, @daily, @weekly, @monthly, @yearly',
      '  - Custom: @every_5_minutes, @at_12:00, @on_monday, @between_9_17',
      '',
      'Available actions:',
      getActionsHelp(),
    ].join('\n'),
    inputSchema: z.object({
      name: z.string().min(1).max(100).describe('Unique job name'),
      cron: z.string().min(1).describe('Cron expression or preset'),
      action: z.string().min(1).describe('Action to execute (e.g. upload-cleanup, issue-follow-up)'),
      config: z.record(z.string(), z.unknown()).optional().describe('Action configuration (JSON object, action-specific params)'),
    }),
  }, async ({ name, cron, action, config: rawConfig }) => {
    // Check name uniqueness
    const existing = findJob(name)
    if (existing) {
      return errorResult(`Job with name "${name}" already exists`)
    }

    // Validate cron expression
    try {
      const { Cron } = await import('cronbake')
      if (!Cron.isValid(cron as any)) {
        return errorResult(`Invalid cron expression: ${cron}`)
      }
    } catch {
      return errorResult(`Invalid cron expression: ${cron}`)
    }

    // Spread rawConfig first, then force action to prevent override from config body
    const taskConfig: TaskConfig = { ...(rawConfig ?? {}), action }

    // Validate action + config
    const validationError = await validateActionConfig(action, taskConfig)
    if (validationError) return errorResult(validationError)

    // Insert into DB (taskType = category from action definition)
    const actionDef = getAction(action)
    const [row] = db.insert(cronJobs).values({
      name,
      cron,
      taskType: actionDef?.category ?? 'custom',
      taskConfig: JSON.stringify(taskConfig),
      enabled: true,
    }).returning().all()

    // Sync to Baker
    syncJob(name)

    logger.info({ name, cron, action }, 'cron_job_created_via_mcp')
    return textResult(serializeJob(row))
  })

  // ==================== cron-delete ====================

  server.registerTool('cron-delete', {
    title: 'Delete Cron Job',
    description: 'Delete a cron job by ID or name. Builtin jobs can also be deleted (they will be re-created on next restart).',
    inputSchema: z.object({
      job: z.string().describe('Job ID or name'),
    }),
  }, async ({ job }) => {
    const row = findJob(job)
    if (!row) return errorResult('Job not found')

    // Soft-delete in DB
    db.update(cronJobs)
      .set({ isDeleted: 1 })
      .where(eq(cronJobs.id, row.id))
      .run()

    // Remove from Baker
    try {
      const b = getBaker()
      b.stop(row.name)
      b.remove(row.name)
    } catch {
      // Job may not be in Baker
    }

    logger.info({ name: row.name }, 'cron_job_deleted_via_mcp')
    return textResult({ deleted: true, name: row.name })
  })

  // ==================== cron-trigger ====================

  server.registerTool('cron-trigger', {
    title: 'Trigger Cron Job',
    description: 'Manually trigger a cron job to execute immediately, regardless of its schedule.',
    inputSchema: z.object({
      job: z.string().describe('Job ID or name'),
    }),
  }, async ({ job }) => {
    const row = findJob(job)
    if (!row) return errorResult('Job not found')

    // Check Baker's overrun protection before direct execution
    try {
      const b = getBaker()
      const status = b.getStatus(row.name)
      if (status === 'running') {
        return errorResult(`Job "${row.name}" is already running (overrun protection active)`)
      }
    } catch {
      // Job not in Baker (disabled or unloaded), proceed with direct execution
    }

    let config: TaskConfig
    try {
      config = JSON.parse(row.taskConfig)
    } catch {
      return errorResult(`Job "${row.name}" has corrupt taskConfig in database`)
    }

    const logId = await executeTask(row.id, row.name, config)

    // Fetch the exact log entry created by this execution
    const [log] = db
      .select()
      .from(cronJobLogs)
      .where(eq(cronJobLogs.id, logId))
      .all()

    return textResult({
      triggered: true,
      name: row.name,
      log: log
        ? {
            status: log.status,
            durationMs: log.durationMs,
            result: log.result,
            error: log.error,
          }
        : null,
    })
  })

  // ==================== cron-pause / cron-resume ====================

  server.registerTool('cron-pause', {
    title: 'Pause Cron Job',
    description: 'Pause a running cron job. It will not execute until resumed.',
    inputSchema: z.object({
      job: z.string().describe('Job ID or name'),
    }),
  }, async ({ job }) => {
    const row = findJob(job)
    if (!row) return errorResult('Job not found')

    db.update(cronJobs)
      .set({ enabled: false })
      .where(eq(cronJobs.id, row.id))
      .run()

    try {
      getBaker().pause(row.name)
    } catch {
      // Job may not be in Baker
    }

    return textResult({ paused: true, name: row.name })
  })

  server.registerTool('cron-resume', {
    title: 'Resume Cron Job',
    description: 'Resume a paused cron job.',
    inputSchema: z.object({
      job: z.string().describe('Job ID or name'),
    }),
  }, async ({ job }) => {
    const row = findJob(job)
    if (!row) return errorResult('Job not found')

    db.update(cronJobs)
      .set({ enabled: true })
      .where(eq(cronJobs.id, row.id))
      .run()

    // Re-sync to Baker (re-register + start)
    syncJob(row.name)

    return textResult({ resumed: true, name: row.name })
  })

  // ==================== cron-get-logs ====================

  server.registerTool('cron-get-logs', {
    title: 'Get Cron Job Logs',
    description: 'View execution logs for a cron job. Supports pagination and status filtering.',
    inputSchema: z.object({
      job: z.string().describe('Job ID or name'),
      status: z.enum(['success', 'failed', 'running']).optional().describe('Filter by execution status'),
      limit: z.number().min(1).max(100).optional().describe('Max results (default: 20)'),
      cursor: z.string().optional().describe('Pagination cursor (log ID from previous page)'),
    }),
  }, async ({ job, status, limit, cursor }) => {
    const row = findJob(job)
    if (!row) return errorResult('Job not found')

    const pageLimit = limit ?? 20
    const conditions = [eq(cronJobLogs.jobId, row.id)]

    if (status) {
      conditions.push(eq(cronJobLogs.status, status))
    }

    if (cursor) {
      // ULID is time-sortable, so we can use it for cursor-based pagination
      conditions.push(lt(cronJobLogs.id, cursor))
    }

    const logs = db
      .select()
      .from(cronJobLogs)
      .where(and(...conditions))
      .orderBy(desc(cronJobLogs.id))
      .limit(pageLimit + 1) // fetch one extra to detect hasMore
      .all()

    const hasMore = logs.length > pageLimit
    const page = hasMore ? logs.slice(0, pageLimit) : logs
    const nextCursor = hasMore ? page.at(-1)!.id : null

    return textResult({
      jobName: row.name,
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
    })
  })
}
