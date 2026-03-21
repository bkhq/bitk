import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { findProject, getDefaultEngine, getEngineDefaultModel, getServerUrl } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'
import {
  createIssueSchema,
  parseProjectEnvVars,
  serializeIssue,
  serializeTags,
  triggerIssueExecution,
} from './_shared'

const create = new Hono()

// POST /api/projects/:projectId/issues — Create issue
create.post(
  '/',
  zValidator('json', createIssueSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId')!
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }

    const body = c.req.valid('json')

    // Resolve engine/model defaults when not explicitly provided
    let resolvedEngine = body.engineType ?? null
    let resolvedModel = body.model ?? null

    if (!resolvedEngine) {
      const defaultEng = (await getDefaultEngine()) || 'claude-code'
      // Legacy bare 'acp' maps to 'acp:gemini' (the default ACP agent)
      resolvedEngine = (defaultEng === 'acp' ? 'acp:gemini' : defaultEng) as EngineType
    }
    if (!resolvedModel) {
      // Leave model unset — let the engine CLI use its own default.
      // Only fill from saved settings if the user explicitly configured one.
      const savedModel = await getEngineDefaultModel(resolvedEngine!)
      if (savedModel && savedModel !== 'auto') {
        resolvedModel = savedModel
      }
    }

    try {
      const issuePrompt = body.title
      const shouldExecute = body.statusId === 'working' || body.statusId === 'review'
      // review → working: auto-downgrade so the execution engine picks it up
      const effectiveStatusId = body.statusId === 'review' ? 'working' : body.statusId

      const [newIssue] = await db.transaction(async (tx) => {
        // Compute next issueNumber across ALL issues (including soft-deleted) to avoid reuse
        const [maxNumRow] = await tx
          .select({ maxNum: max(issuesTable.issueNumber) })
          .from(issuesTable)
          .where(eq(issuesTable.projectId, project.id))
        const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

        // Compute sortOrder: place after the last item in the target status column
        const [lastItem] = await tx
          .select({ sortOrder: issuesTable.sortOrder })
          .from(issuesTable)
          .where(
            and(
              eq(issuesTable.projectId, project.id),
              eq(issuesTable.statusId, effectiveStatusId),
              eq(issuesTable.isDeleted, 0),
            ),
          )
          .orderBy(desc(issuesTable.sortOrder))
          .limit(1)
        const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

        return tx
          .insert(issuesTable)
          .values({
            projectId: project.id,
            statusId: effectiveStatusId,
            issueNumber,
            title: body.title,
            tag: serializeTags(body.tags),
            sortOrder,
            useWorktree: body.useWorktree ?? false,
            keepAlive: body.keepAlive ?? false,
            engineType: resolvedEngine,
            model: resolvedModel,
            sessionStatus: shouldExecute ? 'pending' : null,
            prompt: issuePrompt,
          })
          .returning()
      })

      // After successful creation, invalidate relevant caches
      await cacheDel(`projectIssueIds:${project.id}`)

      const webhookPayload: Record<string, unknown> = {
        event: 'issue.created',
        issueId: newIssue!.id,
        issueNumber: newIssue!.issueNumber,
        projectId: project.id,
        projectName: project.name,
        title: body.title,
        statusId: effectiveStatusId,
        engineType: resolvedEngine,
        model: resolvedModel,
        timestamp: new Date().toISOString(),
      }
      const serverUrl = await getServerUrl()
      if (serverUrl) {
        webhookPayload.issueUrl = buildIssueUrl(serverUrl, project.id, newIssue!.id)
      }
      void webhookDispatch('issue.created', webhookPayload, `issue.created:${newIssue!.id}`)

      // Only auto-execute when created directly in working
      if (shouldExecute) {
        triggerIssueExecution(
          newIssue!.id,
          {
            engineType: resolvedEngine,
            prompt: issuePrompt,
            model: resolvedModel,
            permissionMode: body.permissionMode,
          },
          project.directory || undefined,
          project.systemPrompt,
          parseProjectEnvVars(project.envVars),
        )
      }

      return c.json({ success: true, data: serializeIssue(newIssue!) }, shouldExecute ? 202 : 201)
    } catch (error) {
      logger.warn(
        {
          projectId: project.id,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        },
        'issue_create_failed',
      )
      return c.json(
        {
          success: false,
          error: 'Failed to create issue',
        },
        400,
      )
    }
  },
)

export default create
