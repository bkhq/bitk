import { and, desc, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { serializeIssue } from './_shared'

const review = createOpenAPIRouter()

// GET /api/issues/review — List all review issues across all projects
review.get('/', async (c) => {
  const rows = await db
    .select({
      issue: issuesTable,
      projectName: projectsTable.name,
      projectAlias: projectsTable.alias,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(issuesTable.statusId, 'review'),
        eq(issuesTable.isDeleted, 0),
        eq(projectsTable.isDeleted, 0),
      ),
    )
    .orderBy(desc(issuesTable.statusUpdatedAt))

  const data = rows.map(r => ({
    ...serializeIssue(r.issue),
    projectName: r.projectName,
    projectAlias: r.projectAlias,
  }))

  return c.json({ success: true, data })
})

export default review
