import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import {
  attachments as attachmentsTable,
  issueLogs as issueLogsTable,
  issues as issuesTable,
  issuesLogsToolsCall as toolsCallTable,
} from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'

const del = new Hono()

// DELETE /api/projects/:projectId/issues/:id — Soft-delete an issue
del.delete('/:id', async (c) => {
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

  // Cancel any active session before deleting
  if (
    existing.sessionStatus === 'running' ||
    existing.sessionStatus === 'pending'
  ) {
    void issueEngine.cancelIssue(issueId).catch((err) => {
      logger.error({ issueId, err }, 'delete_cancel_failed')
    })
  }

  await db.transaction(async (tx) => {
    // Collect child issue IDs before soft-deleting
    const childIssues = await tx
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.parentIssueId, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    const childIds = childIssues.map((c) => c.id)
    const allIssueIds = [issueId, ...childIds]

    // Soft-delete the issue
    await tx
      .update(issuesTable)
      .set({ isDeleted: 1 })
      .where(eq(issuesTable.id, issueId))

    // Soft-delete child issues
    if (childIds.length > 0) {
      await tx
        .update(issuesTable)
        .set({ isDeleted: 1 })
        .where(inArray(issuesTable.id, childIds))
    }

    // Soft-delete related logs
    await tx
      .update(issueLogsTable)
      .set({ isDeleted: 1 })
      .where(inArray(issueLogsTable.issueId, allIssueIds))

    // Soft-delete related tool calls
    await tx
      .update(toolsCallTable)
      .set({ isDeleted: 1 })
      .where(inArray(toolsCallTable.issueId, allIssueIds))

    // Soft-delete related attachments
    await tx
      .update(attachmentsTable)
      .set({ isDeleted: 1 })
      .where(inArray(attachmentsTable.issueId, allIssueIds))
  })

  // Invalidate caches
  await cacheDel(`issue:${project.id}:${issueId}`)
  await cacheDelByPrefix(`projectIssueIds:${project.id}`)
  await cacheDelByPrefix(`childCounts:${project.id}`)

  logger.info({ projectId: project.id, issueId }, 'issue_deleted')

  return c.json({ success: true, data: { id: issueId } })
})

export default del
