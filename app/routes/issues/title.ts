import { Hono } from 'hono'
import { findProject } from '../../db/helpers'
import { issueEngine } from '../../engines/issue'
import { AUTO_TITLE_PROMPT } from '../../engines/issue/title'
import { getProjectOwnedIssue } from './_shared'

const title = new Hono()

// POST /api/projects/:projectId/issues/:id/auto-title — Trigger AI auto-title
title.post('/:id/auto-title', async (c) => {
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

  const result = await issueEngine.followUpIssue(
    issueId,
    AUTO_TITLE_PROMPT,
    undefined,
    undefined,
    undefined,
    undefined,
    { type: 'system' },
  )

  return c.json({
    success: true,
    data: { executionId: result.executionId, issueId },
  })
})

export default title
