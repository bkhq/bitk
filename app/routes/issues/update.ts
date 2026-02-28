import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheDelByPrefix, cacheGetOrSet } from '../../cache'
import { db } from '../../db'
import { findProject } from '../../db/helpers'
import { issues as issuesTable } from '../../db/schema'
import { issueEngine, setIssueDevMode } from '../../engines/issue'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'
import {
  bulkUpdateSchema,
  flushPendingAsFollowUp,
  serializeIssue,
  triggerIssueExecution,
  updateIssueSchema,
} from './_shared'

const update = new Hono()

// PATCH /api/projects/:projectId/issues/bulk — Bulk update issues
update.patch(
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
    const projectIssueIds = await cacheGetOrSet<string[]>(
      `projectIssueIds:${project.id}`,
      60,
      async () => {
        const rows = await db
          .select({ id: issuesTable.id })
          .from(issuesTable)
          .where(and(eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)))
        return rows.map((i) => i.id)
      },
    )
    const projectIssueIdSet = new Set(projectIssueIds)

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
        if (!projectIssueIdSet.has(u.id)) continue

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

    // Invalidate issue caches after bulk update
    for (const u of body.updates) {
      await cacheDel(`issue:${project.id}:${u.id}`)
    }

    return c.json({ success: true, data: updated })
  },
)

// PATCH /api/projects/:projectId/issues/:id — Update single issue
update.patch(
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

    // Invalidate issue cache after update
    await cacheDel(`issue:${project.id}:${issueId}`)
    if (body.parentIssueId !== undefined) {
      await cacheDelByPrefix(`childCounts:${project.id}`)
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

export default update
