import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { cronJobLogs, issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { ensureWorking, parseProjectEnvVars } from '@/routes/issues/_shared'
import { getBuiltinHandler } from './registry'

export interface TaskConfig {
  handler?: string // for builtin tasks
  projectId?: string // for issue tasks
  issueId?: string // for issue-follow-up
  prompt?: string // for issue tasks
  engineType?: string // for issue-execute
  model?: string // for issue tasks
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
      case 'issue-follow-up': {
        result = await executeIssueFollowUp(taskConfig)
        break
      }
      case 'issue-execute': {
        result = await executeIssueCreate(taskConfig)
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

// ---------- Issue task handlers ----------

async function resolveIssue(config: TaskConfig) {
  const { projectId, issueId } = config
  if (!projectId) throw new Error('taskConfig.projectId is required')
  if (!issueId) throw new Error('taskConfig.issueId is required')

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

  return { project, issue }
}

async function executeIssueFollowUp(config: TaskConfig): Promise<string> {
  const { project, issue } = await resolveIssue(config)
  const prompt = config.prompt
  if (!prompt) throw new Error('taskConfig.prompt is required for issue-follow-up')

  const guard = await ensureWorking(issue)
  if (!guard.ok) throw new Error(guard.reason!)

  const result = await issueEngine.followUpIssue(
    issue.id,
    prompt,
    config.model ?? issue.model ?? undefined,
  )

  return `follow-up sent to issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
}

async function executeIssueCreate(config: TaskConfig): Promise<string> {
  const { project, issue } = await resolveIssue(config)
  const prompt = config.prompt
  if (!prompt) throw new Error('taskConfig.prompt is required for issue-execute')

  const guard = await ensureWorking(issue)
  if (!guard.ok) throw new Error(guard.reason!)

  const engineType = (config.engineType ?? issue.engineType ?? 'claude-code') as EngineType
  const basePrompt = project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt
  const envVars = parseProjectEnvVars(project.envVars)

  const result = await issueEngine.executeIssue(issue.id, {
    engineType,
    prompt: basePrompt,
    workingDir: project.directory || undefined,
    model: config.model ?? issue.model ?? undefined,
    envVars,
  })

  return `execution started for issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
}
