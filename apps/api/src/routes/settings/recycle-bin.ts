import { zValidator } from '@hono/zod-validator'
import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import * as z from 'zod'
import { cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { logger } from '@/logger'

const recycleBin = new Hono()

// GET /api/settings/deleted-issues — list all soft-deleted issues
recycleBin.get('/deleted-issues', async (c) => {
  const rows = await db
    .select({
      id: issuesTable.id,
      title: issuesTable.title,
      projectId: issuesTable.projectId,
      statusId: issuesTable.statusId,
      updatedAt: issuesTable.updatedAt,
    })
    .from(issuesTable)
    .where(eq(issuesTable.isDeleted, 1))
    .orderBy(issuesTable.updatedAt)

  // Fetch project names for display
  const projectIds = [...new Set(rows.map(r => r.projectId))]
  const projectNames = new Map<string, string>()
  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds))
    for (const p of projects) {
      projectNames.set(p.id, p.name)
    }
  }

  const items = rows.map(r => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: projectNames.get(r.projectId) ?? r.projectId,
    statusId: r.statusId,
    deletedAt: r.updatedAt?.toISOString() ?? null,
  }))

  return c.json({ success: true, data: items })
})

// POST /api/settings/deleted-issues/:id/restore — restore a soft-deleted issue
recycleBin.post(
  '/deleted-issues/:id/restore',
  zValidator('param', z.object({ id: z.string().min(1).max(32) }), (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid issue ID' }, 400)
    }
  }),
  async (c) => {
    const issueId = c.req.valid('param').id
    const [existing] = await db.select().from(issuesTable).where(eq(issuesTable.id, issueId))

    if (!existing || existing.isDeleted !== 1) {
      return c.json({ success: false, error: 'Deleted issue not found' }, 404)
    }

    // Check that the parent project still exists (not hard-deleted)
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, existing.projectId))

    if (!project) {
      return c.json({ success: false, error: 'Parent project no longer exists' }, 400)
    }

    // If the project is also soft-deleted, restore it too
    if (project.isDeleted === 1) {
      await db.update(projectsTable).set({ isDeleted: 0 }).where(eq(projectsTable.id, project.id))
    }

    await db.update(issuesTable).set({ isDeleted: 0 }).where(eq(issuesTable.id, issueId))

    // Invalidate cached issue lookups for this project to avoid stale data
    await cacheDelByPrefix(`issue:${existing.projectId}:`)

    logger.info({ issueId, projectId: existing.projectId }, 'issue_restored')
    return c.json({ success: true, data: { id: issueId } })
  },
)

export default recycleBin
