import { Hono } from 'hono'
import { findProject } from '../../db/helpers'
import { issueEngine } from '../../engines/issue'
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

  // Parse optional cursor and limit query params for pagination
  const cursorParam = c.req.query('cursor')
  const limitParam = c.req.query('limit')
  let cursor: { turnIndex: number; entryIndex: number } | undefined
  if (cursorParam) {
    const parts = cursorParam.split(':')
    if (parts.length === 2) {
      const turnIndex = Number(parts[0])
      const entryIndex = Number(parts[1])
      if (!Number.isNaN(turnIndex) && !Number.isNaN(entryIndex)) {
        cursor = { turnIndex, entryIndex }
      }
    }
  }
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 100, 1), 1000) : undefined
  const effectiveLimit = limit ?? 100

  const issueLogs = issueEngine.getLogs(issueId, issue.devMode, {
    cursor,
    limit: effectiveLimit + 1, // fetch one extra to detect hasMore
  })

  const hasMore = issueLogs.length > effectiveLimit
  const logs = hasMore ? issueLogs.slice(0, effectiveLimit) : issueLogs
  const lastEntry = logs[logs.length - 1]
  const nextCursor =
    hasMore && lastEntry
      ? `${lastEntry.turnIndex ?? 0}:${(lastEntry.metadata as Record<string, unknown> | undefined)?._cursorEntryIndex ?? 0}`
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
