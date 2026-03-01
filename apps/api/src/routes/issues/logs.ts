import { Hono } from 'hono'
import { findProject } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const logs = new Hono()

function parseCursor(
  param: string | undefined,
): { turnIndex: number; entryIndex: number } | undefined {
  if (!param) return undefined
  const parts = param.split(':')
  if (parts.length !== 2) return undefined
  const turnIndex = Number(parts[0])
  const entryIndex = Number(parts[1])
  if (Number.isNaN(turnIndex) || Number.isNaN(entryIndex)) return undefined
  return { turnIndex, entryIndex }
}

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

  const cursorParam = c.req.query('cursor')
  const beforeParam = c.req.query('before')
  const limitParam = c.req.query('limit')

  const cursor = parseCursor(cursorParam)
  const before = parseCursor(beforeParam)

  const limit = limitParam
    ? Math.min(Math.max(Number(limitParam) || 30, 1), 1000)
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
  const logs = hasMore
    ? isReverse
      ? issueLogs.slice(-effectiveLimit)
      : issueLogs.slice(0, effectiveLimit)
    : issueLogs

  // nextCursor: for reverse → points to the oldest entry in the batch (first)
  //   so the client can pass it as `before` for the next older page.
  // For forward → points to the newest entry (last) for the next newer page.
  const cursorEntry = isReverse ? logs[0] : logs[logs.length - 1]
  const nextCursor =
    hasMore && cursorEntry
      ? `${cursorEntry.turnIndex ?? 0}:${(cursorEntry.metadata as Record<string, unknown> | undefined)?._cursorEntryIndex ?? 0}`
      : null

  return c.json({
    success: true,
    data: {
      issue: serializeIssue(issue),
      logs,
      nextCursor,
      hasMore,
    },
  })
})

export default logs
