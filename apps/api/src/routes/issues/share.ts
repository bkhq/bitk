import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { customAlphabet } from 'nanoid'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { getProjectOwnedIssue, invalidateIssueCache } from './_shared'

const shareToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

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

  // Generate new token
  const token = shareToken()
  await db
    .update(issuesTable)
    .set({ shareToken: token })
    .where(eq(issuesTable.id, issueId))
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
