import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheGetOrSet } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const query = new Hono()

// GET /api/projects/:projectId/issues — List issues
query.get('/', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const parentId = c.req.query('parentId')

  const conditions = [
    eq(issuesTable.projectId, project.id),
    eq(issuesTable.isDeleted, 0),
  ]

  if (parentId === 'null' || parentId === '') {
    // Root issues only (no parent)
    conditions.push(isNull(issuesTable.parentIssueId))
  } else if (parentId) {
    // Children of a specific issue
    conditions.push(eq(issuesTable.parentIssueId, parentId))
  }

  const rows = await db
    .select()
    .from(issuesTable)
    .where(and(...conditions))
    .orderBy(desc(issuesTable.statusUpdatedAt))

  // Compute child counts for returned issues
  const childCounts = await cacheGetOrSet<Record<string, number>>(
    `childCounts:${project.id}`,
    30,
    async () => {
      const childRows = await db
        .select({
          parentIssueId: issuesTable.parentIssueId,
          cnt: count(),
        })
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.projectId, project.id),
            eq(issuesTable.isDeleted, 0),
          ),
        )
        .groupBy(issuesTable.parentIssueId)
      const map: Record<string, number> = {}
      for (const cr of childRows) {
        if (cr.parentIssueId) map[cr.parentIssueId] = cr.cnt
      }
      return map
    },
  )

  return c.json({
    success: true,
    data: rows.map((r) => serializeIssue(r, childCounts[r.id])),
  })
})

// GET /api/projects/:projectId/issues/:id — Get single issue with children
query.get('/:id', async (c) => {
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

  // Fetch children
  const children = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.parentIssueId, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )
    .orderBy(desc(issuesTable.statusUpdatedAt))

  return c.json({
    success: true,
    data: {
      ...serializeIssue(issue, children.length),
      children: children.map((ch) => serializeIssue(ch)),
    },
  })
})

export default query
