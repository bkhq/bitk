import type { EngineType } from '../../engines/types'
import { zValidator } from '@hono/zod-validator'
import { and, count, eq, isNull, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../../db'
import { findProject, getDefaultEngine, getEngineDefaultModel } from '../../db/helpers'
import { issues as issuesTable } from '../../db/schema'
import { engineRegistry } from '../../engines/executors'
import { issueEngine, setIssueDevMode } from '../../engines/issue-engine'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'
import {
  bulkUpdateSchema,
  createIssueSchema,
  flushPendingAsFollowUp,
  serializeIssue,
  triggerIssueExecution,
  updateIssueSchema,
} from './_shared'

const crud = new Hono()

// ---------- CRUD ----------

crud.get('/', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const parentId = c.req.query('parentId')

  const conditions = [eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)]

  if (parentId === 'null' || parentId === '') {
    // Root issues only (no parent)
    conditions.push(isNull(issuesTable.parentIssueId))
  } else if (parentId) {
    // Children of a specific issue
    conditions.push(eq(issuesTable.parentIssueId, parentId))
  }

  const rows = await db
    .select()
    .from(issuesTable)
    .where(and(...conditions))

  // Compute child counts for returned issues
  const issueIds = rows.map((r) => r.id)
  const childCountMap = new Map<string, number>()
  if (issueIds.length > 0) {
    const childRows = await db
      .select({
        parentIssueId: issuesTable.parentIssueId,
        cnt: count(),
      })
      .from(issuesTable)
      .where(and(eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)))
      .groupBy(issuesTable.parentIssueId)
    for (const cr of childRows) {
      if (cr.parentIssueId) {
        childCountMap.set(cr.parentIssueId, cr.cnt)
      }
    }
  }

  return c.json({
    success: true,
    data: rows.map((r) => serializeIssue(r, childCountMap.get(r.id))),
  })
})

crud.post(
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
      resolvedEngine = (await getDefaultEngine()) || 'echo'
    }
    if (!resolvedModel) {
      const savedModel = await getEngineDefaultModel(resolvedEngine)
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

      return c.json({ success: true, data: serializeIssue(newIssue!) }, 201)
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

crud.patch(
  '/bulk',
  zValidator('json', bulkUpdateSchema, (result, c) => {
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

    // Get all project issue IDs for ownership validation
    const projectIssues = await db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(and(eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)))
    const projectIssueIds = new Set(projectIssues.map((i) => i.id))

    const updated: ReturnType<typeof serializeIssue>[] = []
    // Collect issues that need execution after transaction commits
    const toExecute: Array<{
      id: string
      engineType: string | null
      prompt: string | null
      model: string | null
    }> = []
    // Collect issues that already have a session but need pending messages flushed
    const toFlush: Array<{ id: string; model: string | null }> = []
    // Collect issues transitioning to done that need active processes cancelled
    const toCancel: string[] = []

    await db.transaction(async (tx) => {
      for (const u of body.updates) {
        if (!projectIssueIds.has(u.id)) continue

        const changes: Record<string, unknown> = {}
        if (u.statusId !== undefined) changes.statusId = u.statusId
        if (u.sortOrder !== undefined) changes.sortOrder = u.sortOrder
        if (u.priority !== undefined) changes.priority = u.priority

        if (Object.keys(changes).length === 0) continue

        // Check if this is a transition to working that should trigger execution
        if (u.statusId === 'working') {
          const [existing] = await tx.select().from(issuesTable).where(eq(issuesTable.id, u.id))
          if (existing && existing.statusId !== 'working') {
            if (!existing.sessionStatus || existing.sessionStatus === 'pending') {
              changes.sessionStatus = 'pending'
              toExecute.push({
                id: u.id,
                engineType: existing.engineType,
                prompt: existing.prompt,
                model: existing.model,
              })
            } else if (['completed', 'failed', 'cancelled'].includes(existing.sessionStatus)) {
              // Session already finished — flush pending messages as follow-up
              toFlush.push({ id: u.id, model: existing.model })
            }
          }
        }

        // Check if transitioning to done → cancel active processes
        if (u.statusId === 'done') {
          const [existing] = await tx.select().from(issuesTable).where(eq(issuesTable.id, u.id))
          if (existing && existing.statusId !== 'done') {
            toCancel.push(u.id)
          }
        }

        const [row] = await tx
          .update(issuesTable)
          .set(changes)
          .where(eq(issuesTable.id, u.id))
          .returning()
        if (row) {
          updated.push(serializeIssue(row))
        }
      }
    })

    // Fire-and-forget execution for issues that transitioned to working
    for (const issue of toExecute) {
      emitIssueUpdated(issue.id, { statusId: 'working', sessionStatus: 'pending' })
      triggerIssueExecution(issue.id, issue, project.directory || undefined)
    }
    // Flush pending messages for issues with existing sessions
    for (const issue of toFlush) {
      flushPendingAsFollowUp(issue.id, issue)
    }
    // Cancel active processes for issues that transitioned to done
    for (const issueId of toCancel) {
      void issueEngine.cancelIssue(issueId).catch((err) => {
        logger.error({ issueId, err }, 'done_transition_cancel_failed')
      })
    }

    return c.json({ success: true, data: updated })
  },
)

crud.get('/:id', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const [issue] = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  // Fetch children
  const children = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.parentIssueId, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )

  return c.json({
    success: true,
    data: {
      ...serializeIssue(issue, children.length),
      children: children.map((ch) => serializeIssue(ch)),
    },
  })
})

crud.patch(
  '/:id',
  zValidator('json', updateIssueSchema, (result, c) => {
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

    const issueId = c.req.param('id')!
    const [existing] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!existing) {
      return c.json({ success: false, error: 'Issue not found' }, 404)
    }

    const body = c.req.valid('json')
    const updates: Record<string, unknown> = {}
    if (body.title !== undefined) updates.title = body.title
    if (body.priority !== undefined) updates.priority = body.priority
    if (body.statusId !== undefined) {
      updates.statusId = body.statusId
    }
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder
    if (body.devMode !== undefined) {
      updates.devMode = body.devMode
      setIssueDevMode(issueId, body.devMode)
    }
    if (body.parentIssueId !== undefined) {
      if (body.parentIssueId === null) {
        updates.parentIssueId = null
      } else {
        if (body.parentIssueId === issueId) {
          return c.json({ success: false, error: 'Issue cannot be its own parent' }, 400)
        }
        const [parent] = await db
          .select({ id: issuesTable.id, parentIssueId: issuesTable.parentIssueId })
          .from(issuesTable)
          .where(
            and(
              eq(issuesTable.id, body.parentIssueId),
              eq(issuesTable.projectId, project.id),
              eq(issuesTable.isDeleted, 0),
            ),
          )
        if (!parent) {
          return c.json({ success: false, error: 'Parent issue not found in this project' }, 400)
        }
        if (parent.parentIssueId) {
          return c.json(
            { success: false, error: 'Cannot create sub-issue of a sub-issue (max depth is 1)' },
            400,
          )
        }
        updates.parentIssueId = body.parentIssueId
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ success: true, data: serializeIssue(existing) })
    }

    // Check if transitioning to working → trigger execution or flush
    const transitioningToWorking = body.statusId === 'working' && existing.statusId !== 'working'
    const shouldExecute =
      transitioningToWorking && (!existing.sessionStatus || existing.sessionStatus === 'pending')
    const shouldFlush =
      transitioningToWorking &&
      !shouldExecute &&
      ['completed', 'failed', 'cancelled'].includes(existing.sessionStatus ?? '')

    // Check if transitioning to done → cancel active processes
    const transitioningToDone = body.statusId === 'done' && existing.statusId !== 'done'

    if (shouldExecute) {
      updates.sessionStatus = 'pending'
    }

    const [row] = await db
      .update(issuesTable)
      .set(updates)
      .where(eq(issuesTable.id, issueId))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Issue not found' }, 404)
    }

    if (shouldExecute) {
      emitIssueUpdated(issueId, { statusId: 'working', sessionStatus: 'pending' })
      triggerIssueExecution(
        issueId,
        { engineType: existing.engineType, prompt: existing.prompt, model: existing.model },
        project.directory || undefined,
      )
    } else if (shouldFlush) {
      flushPendingAsFollowUp(issueId, { model: existing.model })
    }

    // Fire-and-forget cancel for done transition
    if (transitioningToDone) {
      void issueEngine.cancelIssue(issueId).catch((err) => {
        logger.error({ issueId, err }, 'done_transition_cancel_failed')
      })
    }

    return c.json({ success: true, data: serializeIssue(row) })
  },
)

export default crud
