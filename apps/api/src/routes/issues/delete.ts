import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
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

  // Best-effort terminate: try to kill active processes before soft-delete.
  // Use a short timeout (5s) so the DELETE request doesn't block on lock
  // contention. If termination fails or times out, proceed with deletion
  // anyway — the reconciler will clean up orphaned processes on its next run.
  const shouldTerminate =
    existing.sessionStatus === 'running' ||
    existing.sessionStatus === 'pending' ||
    issueEngine.hasActiveProcessForIssue(issueId)
  if (shouldTerminate) {
    try {
      await Promise.race([
        issueEngine.terminateProcess(issueId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('terminate timeout')), 5_000),
        ),
      ])
    } catch (err) {
      logger.warn({ issueId, err }, 'delete_terminate_failed_proceeding')
    }
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

    // Soft-delete the issue only — keep logs/tools/attachments intact for restore
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
  })

  // Invalidate caches
  await cacheDel(`issue:${project.id}:${issueId}`)
  await cacheDelByPrefix(`projectIssueIds:${project.id}`)
  await cacheDelByPrefix(`childCounts:${project.id}`)

  logger.info({ projectId: project.id, issueId }, 'issue_deleted')

  return c.json({ success: true, data: { id: issueId } })
})

export default del
