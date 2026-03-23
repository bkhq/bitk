import { and, desc, eq, lt } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { logger } from '@/logger'
import { executeTask } from './executor'
import { getBaker, syncJob } from './index'
import { getBuiltinHandler } from './registry'
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

function validateTaskConfig(taskType: string, config: TaskConfig, jobName: string): string | null {
  switch (taskType) {
    case 'builtin': {
      const handlerName = config.handler ?? jobName
      if (!getBuiltinHandler(handlerName)) {
        return `Unknown builtin handler: "${handlerName}". Available: upload-cleanup, worktree-cleanup, log-cleanup`
      }
      return null
    }
    case 'issue-follow-up': {
      if (!config.projectId) return 'taskConfig.projectId is required for issue-follow-up'
      if (!config.issueId) return 'taskConfig.issueId is required for issue-follow-up'
      if (!config.prompt) return 'taskConfig.prompt is required for issue-follow-up'
      return null
    }
    case 'issue-execute': {
      if (!config.projectId) return 'taskConfig.projectId is required for issue-execute'
      if (!config.issueId) return 'taskConfig.issueId is required for issue-execute'
      if (!config.prompt) return 'taskConfig.prompt is required for issue-execute'
      return null
    }
    default:
      return `Unsupported task type: "${taskType}"`
  }
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
      'Task types:',
      '  - builtin: run a built-in handler (upload-cleanup, worktree-cleanup, log-cleanup)',
      '  - issue-follow-up: send a follow-up message to an existing issue on schedule',
      '    taskConfig: { projectId, issueId, prompt, model? }',
      '  - issue-execute: trigger execution on an existing issue on schedule',
      '    taskConfig: { projectId, issueId, prompt, engineType?, model? }',
    ].join('\n'),
    inputSchema: z.object({
      name: z.string().min(1).max(100).describe('Unique job name'),
      cron: z.string().min(1).describe('Cron expression or preset'),
      taskType: z.enum(['builtin', 'issue-follow-up', 'issue-execute']).describe('Task type'),
      taskConfig: z.record(z.string(), z.unknown()).optional().describe('Task configuration (JSON object)'),
    }),
  }, async ({ name, cron, taskType, taskConfig }) => {
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

    const config = (taskConfig ?? {}) as TaskConfig

    // Validate taskConfig based on taskType
    const validationError = validateTaskConfig(taskType, config, name)
    if (validationError) return errorResult(validationError)

    // Insert into DB
    const [row] = db.insert(cronJobs).values({
      name,
      cron,
      taskType,
      taskConfig: JSON.stringify(config),
      enabled: true,
    }).returning().all()

    // Sync to Baker
    syncJob(name)

    logger.info({ name, cron, taskType }, 'cron_job_created_via_mcp')
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

    // Try to trigger through Baker (respects overrunProtection)
    const baker = getBaker()
    try {
      const status = baker.getStatus(row.name)
      if (status === 'running') {
        return errorResult(`Job "${row.name}" is already running (overrun protection active)`)
      }
    } catch {
      // Job not in Baker, proceed with direct execution
    }

    const config: TaskConfig = JSON.parse(row.taskConfig)
    await executeTask(row.id, row.name, row.taskType, config)

    // Get the latest log for this job
    const [log] = db
      .select()
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, row.id))
      .orderBy(desc(cronJobLogs.startedAt))
      .limit(1)
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
