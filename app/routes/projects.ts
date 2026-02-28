import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { and, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'
import { db } from '../db'
import { findProject, invalidateProjectCache } from '../db/helpers'
import { projects as projectsTable } from '../db/schema'

import { toISO } from '../utils/date'

const aliasId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

const aliasRegex = /^[a-z0-9]+$/

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  alias: z.string().min(1).max(200).regex(aliasRegex).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  alias: z.string().min(1).max(200).regex(aliasRegex).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
})

type ProjectRow = typeof projectsTable.$inferSelect

function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    alias: row.alias,
    name: row.name,
    description: row.description ?? undefined,
    directory: row.directory ?? undefined,
    repositoryUrl: row.repositoryUrl ?? undefined,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

function generateAlias(name: string): string {
  const alias = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return alias || aliasId()
}

async function uniqueAlias(base: string, excludeId?: string): Promise<string> {
  let candidate = base
  let suffix = 2
  for (;;) {
    const [existing] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.alias, candidate))
    if (!existing || (excludeId && existing.id === excludeId)) {
      return candidate
    }
    candidate = `${base}${suffix}`
    suffix++
  }
}

/** Normalize a directory path: resolve `.` / `..`, collapse duplicate `/`, strip trailing `/` */
function normalizeDir(dir: string): string {
  const resolved = resolve(dir)
  // resolve already handles trailing slash, but keep root `/` as-is
  return resolved
}

async function isDirectoryTaken(directory: string, excludeId?: string): Promise<boolean> {
  const conditions = [eq(projectsTable.directory, directory), eq(projectsTable.isDeleted, 0)]
  if (excludeId) {
    conditions.push(ne(projectsTable.id, excludeId))
  }
  const [existing] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(...conditions))
  return !!existing
}

const projects = new Hono()

projects.get('/', async (c) => {
  const rows = await db.select().from(projectsTable).where(eq(projectsTable.isDeleted, 0))
  return c.json({ success: true, data: rows.map(serializeProject) })
})

projects.post(
  '/',
  zValidator('json', createProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: result.error.issues.map((i) => i.message).join(', ') },
        400,
      )
    }
  }),
  async (c) => {
    const body = c.req.valid('json')
    const dir = body.directory ? normalizeDir(body.directory) : null

    if (dir && (await isDirectoryTaken(dir))) {
      return c.json({ success: false, error: 'directory_already_used' }, 409)
    }

    const alias = await uniqueAlias(body.alias ?? generateAlias(body.name))
    const [row] = await db
      .insert(projectsTable)
      .values({
        name: body.name,
        alias,
        description: body.description ?? null,
        directory: dir,
        repositoryUrl: body.repositoryUrl || null,
      })
      .returning()

    return c.json({ success: true, data: serializeProject(row!) }, 201)
  },
)

projects.get('/:projectId', async (c) => {
  const row = await findProject(c.req.param('projectId'))
  if (!row) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  return c.json({ success: true, data: serializeProject(row) })
})

projects.patch(
  '/:projectId',
  zValidator('json', updateProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: result.error.issues.map((i) => i.message).join(', ') },
        400,
      )
    }
  }),
  async (c) => {
    const body = c.req.valid('json')
    const existing = await findProject(c.req.param('projectId'))
    if (!existing) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) updates.name = body.name
    if (body.alias !== undefined) {
      const newAlias = await uniqueAlias(body.alias, existing.id)
      updates.alias = newAlias
    }
    if (body.description !== undefined) updates.description = body.description
    if (body.directory !== undefined) {
      const dir = body.directory ? normalizeDir(body.directory) : null
      if (dir && (await isDirectoryTaken(dir, existing.id))) {
        return c.json({ success: false, error: 'directory_already_used' }, 409)
      }
      updates.directory = dir
    }
    if (body.repositoryUrl !== undefined) {
      updates.repositoryUrl = body.repositoryUrl === '' ? null : body.repositoryUrl
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ success: true, data: serializeProject(existing) })
    }

    // Invalidate cache for old ID and alias before updating
    await invalidateProjectCache(existing.id, existing.alias)

    const [row] = await db
      .update(projectsTable)
      .set(updates)
      .where(eq(projectsTable.id, existing.id))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }
    return c.json({ success: true, data: serializeProject(row) })
  },
)

export default projects
