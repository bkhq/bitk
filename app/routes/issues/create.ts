import type { EngineType } from '../../engines/types'
import { zValidator } from '@hono/zod-validator'
import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../../db'
import { findProject, getDefaultEngine, getEngineDefaultModel } from '../../db/helpers'
import { issues as issuesTable } from '../../db/schema'
import { engineRegistry } from '../../engines/executors'
import { createIssueSchema, serializeIssue, triggerIssueExecution } from './_shared'

const create = new Hono()

// POST /api/projects/:projectId/issues — Create issue
create.post(
  '/',
  zValidator('json', createIssueSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: result.error.issues.map((i) => i.message).join(', ') },
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
    // Falls back to 'echo' / 'auto' when no settings exist
    let resolvedEngine = body.engineType ?? null
    let resolvedModel = body.model ?? null

    if (!resolvedEngine) {
      resolvedEngine = ((await getDefaultEngine()) || 'echo') as EngineType
    }
    if (!resolvedModel) {
      const savedModel = await getEngineDefaultModel(resolvedEngine!)
      if (savedModel) {
        resolvedModel = savedModel
      } else {
        const models = await engineRegistry.getModels(resolvedEngine as EngineType)
        resolvedModel = models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? 'auto'
      }
    }

    try {
      const issuePrompt = body.title
      const shouldExecute = body.statusId === 'working'

      const [newIssue] = await db.transaction(async (tx) => {
        // Validate parentIssueId if provided
        if (body.parentIssueId) {
          const [parent] = await tx
            .select()
            .from(issuesTable)
            .where(
              and(
                eq(issuesTable.id, body.parentIssueId),
                eq(issuesTable.projectId, project.id),
                eq(issuesTable.isDeleted, 0),
              ),
            )
          if (!parent) {
            throw new Error('Parent issue not found in this project')
          }
          // Depth=1 only: parent must not itself be a sub-issue
          if (parent.parentIssueId) {
            throw new Error('Cannot create sub-issue of a sub-issue (max depth is 1)')
          }
        }

        // Compute next issueNumber across ALL issues (including soft-deleted) to avoid reuse
        const [maxNumRow] = await tx
          .select({ maxNum: max(issuesTable.issueNumber) })
          .from(issuesTable)
          .where(eq(issuesTable.projectId, project.id))
        const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

        // Compute max sortOrder within the target status column
        const [maxOrderRow] = await tx
          .select({ maxOrder: max(issuesTable.sortOrder) })
          .from(issuesTable)
          .where(
            and(
              eq(issuesTable.projectId, project.id),
              eq(issuesTable.statusId, body.statusId),
              eq(issuesTable.isDeleted, 0),
            ),
          )
        const sortOrder = (maxOrderRow?.maxOrder ?? -1) + 1

        return tx
          .insert(issuesTable)
          .values({
            projectId: project.id,
            statusId: body.statusId,
            issueNumber,
            title: body.title,
            priority: body.priority,
            sortOrder,
            parentIssueId: body.parentIssueId ?? null,
            useWorktree: body.useWorktree ?? false,
            engineType: resolvedEngine,
            model: resolvedModel,
            sessionStatus: shouldExecute ? 'pending' : null,
            prompt: issuePrompt,
          })
          .returning()
      })

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
        )
      }

      return c.json({ success: true, data: serializeIssue(newIssue!) }, shouldExecute ? 202 : 201)
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create issue',
        },
        400,
      )
    }
  },
)

export default create
