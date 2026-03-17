import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { customAlphabet } from 'nanoid'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { getProjectOwnedIssue, invalidateIssueCache } from './_shared'

const generateShareToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

const share = new Hono()

// POST /api/projects/:projectId/issues/:id/share — Generate or return existing share token
share.post('/:id/share', async (c) => {
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

  // Return existing token if already shared
  if (issue.shareToken) {
    return c.json({
      success: true,
      data: { shareToken: issue.shareToken },
    })
  }

  // Atomically set token only when currently null to handle concurrent requests
  const token = generateShareToken()
  const result = await db
    .update(issuesTable)
    .set({ shareToken: token })
    .where(and(eq(issuesTable.id, issueId), isNull(issuesTable.shareToken)))
    .returning({ shareToken: issuesTable.shareToken })

  // Another request may have set the token concurrently — re-read
  if (result.length === 0) {
    const refreshed = await getProjectOwnedIssue(project.id, issueId)
    return c.json({
      success: true,
      data: { shareToken: refreshed!.shareToken },
    })
  }

  await invalidateIssueCache(project.id, issueId)

  return c.json({
    success: true,
    data: { shareToken: token },
  })
})

// DELETE /api/projects/:projectId/issues/:id/share — Remove share token
share.delete('/:id/share', async (c) => {
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

  await db
    .update(issuesTable)
    .set({ shareToken: null })
    .where(eq(issuesTable.id, issueId))
  await invalidateIssueCache(project.id, issueId)

  return c.json({ success: true, data: null })
})

export default share
