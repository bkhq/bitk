import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const query = createOpenAPIRouter()

// GET /api/projects/:projectId/issues — List issues
query.openapi(R.listIssues, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const rows = await db
    .select()
    .from(issuesTable)
    .where(and(eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)))
    .orderBy(desc(issuesTable.isPinned), desc(issuesTable.statusUpdatedAt))

  return c.json({
    success: true,
    data: rows.map(r => serializeIssue(r)),
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:issueId — Get single issue
query.openapi(R.getIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  return c.json({
    success: true,
    data: serializeIssue(issue),
  }, 200 as const)
})

export default query
