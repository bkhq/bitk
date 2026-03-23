import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { cronJobLogs, issues as issuesTable } from '@/db/schema'
import { logger } from '@/logger'
import { getIssueActionHandler } from './actions'
import { getBuiltinHandler } from './registry'

export interface TaskConfig {
  handler?: string // for builtin tasks
  projectId?: string // for issue tasks
  issueId?: string // for issue tasks
  action?: string // for issue tasks — registered action name
  [key: string]: unknown
}

export async function executeTask(
  jobId: string,
  jobName: string,
  taskType: string,
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
    let result: string

    switch (taskType) {
      case 'builtin': {
        const handler = getBuiltinHandler(taskConfig.handler ?? jobName)
        if (!handler) {
          throw new Error(`Unknown builtin handler: ${taskConfig.handler ?? jobName}`)
        }
        result = await handler()
        break
      }
      case 'issue': {
        result = await executeIssueAction(taskConfig)
        break
      }
      default:
        throw new Error(`Unknown task type: ${taskType}`)
    }

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

// ---------- Issue action dispatcher ----------

async function executeIssueAction(config: TaskConfig): Promise<string> {
  const { projectId, issueId, action } = config
  if (!projectId) throw new Error('taskConfig.projectId is required')
  if (!issueId) throw new Error('taskConfig.issueId is required')
  if (!action) throw new Error('taskConfig.action is required')

  const handler = getIssueActionHandler(action)
  if (!handler) throw new Error(`Unknown issue action: ${action}`)

  const project = await findProject(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const [issue] = db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )
    .all()
  if (!issue) throw new Error(`Issue not found: ${issueId}`)

  return handler({ project, issue, config })
}
