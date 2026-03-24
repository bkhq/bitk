import { and, eq } from 'drizzle-orm'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject, getServerUrl } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'

const del = createOpenAPIRouter()

// DELETE /api/projects/:projectId/issues/:issueId — Soft-delete an issue
del.openapi(R.deleteIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
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
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
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

  // Soft-delete the issue only — keep logs/tools/attachments intact for restore
  await db.transaction(async (tx) => {
    await tx
      .update(issuesTable)
      .set({ isDeleted: 1 })
      .where(eq(issuesTable.id, issueId))
  })

  // Invalidate caches
  await cacheDel(`issue:${project.id}:${issueId}`)
  await cacheDelByPrefix(`projectIssueIds:${project.id}`)

  logger.info({ projectId: project.id, issueId }, 'issue_deleted')

  const webhookPayload: Record<string, unknown> = {
    event: 'issue.deleted',
    issueId,
    issueNumber: existing.issueNumber,
    projectId: project.id,
    projectName: project.name,
    title: existing.title,
    timestamp: new Date().toISOString(),
  }
  const serverUrl = await getServerUrl()
  if (serverUrl) {
    webhookPayload.issueUrl = buildIssueUrl(serverUrl, project.id, issueId)
  }
  void webhookDispatch('issue.deleted', webhookPayload, `issue.deleted:${issueId}`)

  return c.json({ success: true, data: { id: issueId } }, 200 as const)
})

export default del
