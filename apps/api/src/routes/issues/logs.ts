import { Hono } from 'hono'
import { findProject } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const logs = new Hono()

// GET /api/projects/:projectId/issues/:id/logs — Get logs
logs.get('/:id/logs', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  // Cursor params are now opaque ULID strings (no parsing needed)
  const cursor = c.req.query('cursor') || undefined
  const before = c.req.query('before') || undefined
  const limitParam = c.req.query('limit')

  const limit = limitParam
    ? Math.min(Math.max(Math.floor(Number(limitParam)) || 30, 1), 1000)
    : undefined
  const effectiveLimit = limit ?? 30

  // Overfetch to compensate for JS isVisibleForMode filter removing entries
  // after the SQL limit is applied (e.g. system-messages without the right subtype).
  const overfetchFactor = issue.devMode ? 1 : 2
  const fetchLimit = effectiveLimit * overfetchFactor + 1

  const issueLogs = issueEngine.getLogs(issueId, issue.devMode, {
    cursor,
    before,
    limit: fetchLimit,
  })

  const isReverse = !cursor
  const hasMore = issueLogs.length > effectiveLimit

  // For reverse: keep the newest entries (tail of ascending array).
  // For forward: keep the oldest entries (head of ascending array).
  const trimmedLogs = hasMore
    ? isReverse
      ? issueLogs.slice(-effectiveLimit)
      : issueLogs.slice(0, effectiveLimit)
    : issueLogs

  // nextCursor: use ULID messageId directly.
  // For reverse → oldest entry in batch (first) so client passes as `before`.
  // For forward → newest entry (last) for next newer page via `cursor`.
  const cursorEntry = isReverse
    ? trimmedLogs[0]
    : trimmedLogs[trimmedLogs.length - 1]
  const nextCursor =
    hasMore && cursorEntry?.messageId ? cursorEntry.messageId : null

  return c.json({
    success: true,
    data: {
      issue: serializeIssue(issue),
      logs: trimmedLogs,
      nextCursor,
      hasMore,
    },
  })
})

export default logs
