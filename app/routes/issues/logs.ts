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

  const issueLogs = issueEngine.getLogs(issueId, issue.devMode)

  return c.json({ success: true, data: { issue: serializeIssue(issue), logs: issueLogs } })
})

export default logs
