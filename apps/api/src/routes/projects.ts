import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { customAlphabet } from 'nanoid'
import * as z from 'zod'
import { cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject, invalidateProjectCache } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { toISO } from '@/utils/date'
import { isGitRepoFresh } from '@/utils/git'

const aliasId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

const aliasRegex = /^[a-z0-9]+$/
const fractionalKeyRegex = /^[a-z0-9]+$/i

const envVarsSchema = z.record(z.string().max(10000)).optional()

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  alias: z.string().min(1).max(200).regex(aliasRegex).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  systemPrompt: z.string().max(32768).optional(),
  envVars: envVarsSchema,
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  alias: z.string().min(1).max(200).regex(aliasRegex).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  systemPrompt: z.string().max(32768).optional(),
  envVars: envVarsSchema,
  sortOrder: z.string().min(1).max(50).regex(fractionalKeyRegex).optional(),
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
    systemPrompt: row.systemPrompt ?? undefined,
    envVars: row.envVars ? (JSON.parse(row.envVars) as Record<string, string>) : undefined,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived === 1,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

async function checkProjectGitRepo(directory: string | null | undefined): Promise<boolean> {
  if (!directory) return false
  const dir = resolve(directory)
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) return false
    return await isGitRepoFresh(dir)
  } catch {
    return false
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
  const archived = c.req.query('archived') === 'true'
  const rows = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.isDeleted, 0), eq(projectsTable.isArchived, archived ? 1 : 0)))
    .orderBy(asc(projectsTable.sortOrder), desc(projectsTable.updatedAt))
  const data = await Promise.all(
    rows.map(async (row) => {
      const gitRepo = await checkProjectGitRepo(row.directory)
      return { ...serializeProject(row), isGitRepo: gitRepo }
    }),
  )
  return c.json({ success: true, data })
})

const sortProjectSchema = z.object({
  id: z.string(),
  sortOrder: z.string().min(1).max(50).regex(fractionalKeyRegex),
})

projects.patch(
  '/sort',
  zValidator('json', sortProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.issues.map(i => i.message).join(', ') }, 400)
    }
  }),
  async (c) => {
    const { id, sortOrder } = c.req.valid('json')
    const existing = await findProject(id)
    if (!existing) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }
    await db
      .update(projectsTable)
      .set({ sortOrder })
      .where(eq(projectsTable.id, existing.id))
    await invalidateProjectCache(existing.id, existing.alias)
    return c.json({ success: true, data: null })
  },
)

projects.post(
  '/',
  zValidator('json', createProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
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

    // Compute sortOrder: place after the last project
    const lastProject = await db
      .select({ sortOrder: projectsTable.sortOrder })
      .from(projectsTable)
      .where(eq(projectsTable.isDeleted, false))
      .orderBy(desc(projectsTable.sortOrder))
      .limit(1)
      .then(rows => rows[0])
    const sortOrder = generateKeyBetween(lastProject?.sortOrder ?? null, null)

    const [row] = await db
      .insert(projectsTable)
      .values({
        name: body.name,
        alias,
        description: body.description ?? null,
        directory: dir,
        repositoryUrl: body.repositoryUrl || null,
        systemPrompt: body.systemPrompt ?? null,
        envVars: body.envVars ? JSON.stringify(body.envVars) : null,
        sortOrder,
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
  const gitRepo = await checkProjectGitRepo(row.directory)
  return c.json({ success: true, data: { ...serializeProject(row), isGitRepo: gitRepo } })
})

projects.patch(
  '/:projectId',
  zValidator('json', updateProjectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
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
    if (body.systemPrompt !== undefined) {
      updates.systemPrompt = body.systemPrompt || null
    }
    if (body.envVars !== undefined) {
      updates.envVars = Object.keys(body.envVars).length > 0 ? JSON.stringify(body.envVars) : null
    }
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

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

projects.delete('/:projectId', async (c) => {
  const existing = await findProject(c.req.param('projectId'))
  if (!existing) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  // Find all active issues and force-terminate live processes before deleting.
  const activeIssues = await db
    .select({ id: issuesTable.id, sessionStatus: issuesTable.sessionStatus })
    .from(issuesTable)
    .where(and(eq(issuesTable.projectId, existing.id), eq(issuesTable.isDeleted, 0)))

  const toTerminate = activeIssues
    .filter(
      issue =>
        issue.sessionStatus === 'running' ||
        issue.sessionStatus === 'pending' ||
        issueEngine.hasActiveProcessForIssue(issue.id),
    )
    .map(issue => issue.id)

  // Best-effort terminate with short timeout (5s per issue). Use allSettled
  // so a single failure doesn't block other terminations or abort the delete.
  if (toTerminate.length > 0) {
    const results = await Promise.allSettled(
      toTerminate.map(issueId =>
        Promise.race([
          issueEngine.terminateProcess(issueId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('terminate timeout')), 5_000),
          ),
        ]),
      ),
    )
    const failures = results.filter(r => r.status === 'rejected')
    if (failures.length > 0) {
      logger.warn(
        {
          projectId: existing.id,
          total: toTerminate.length,
          failed: failures.length,
        },
        'project_delete_some_terminate_failed_proceeding',
      )
    }
  }

  await db.transaction(async (tx) => {
    // Collect issue IDs before soft-deleting
    const projectIssues = await tx
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(and(eq(issuesTable.projectId, existing.id), eq(issuesTable.isDeleted, 0)))
    const issueIds = projectIssues.map(i => i.id)

    // Soft-delete all issues in this project — keep logs/tools/attachments intact for restore
    if (issueIds.length > 0) {
      await tx.update(issuesTable).set({ isDeleted: 1 }).where(inArray(issuesTable.id, issueIds))
    }

    // Soft-delete the project
    await tx.update(projectsTable).set({ isDeleted: 1 }).where(eq(projectsTable.id, existing.id))
  })

  // Invalidate caches
  await invalidateProjectCache(existing.id, existing.alias)
  await cacheDelByPrefix(`projectIssueIds:${existing.id}`)
  await cacheDelByPrefix(`childCounts:${existing.id}`)

  logger.info({ projectId: existing.id }, 'project_deleted')

  return c.json({ success: true, data: { id: existing.id } })
})

projects.post('/:projectId/archive', async (c) => {
  const existing = await findProject(c.req.param('projectId'))
  if (!existing) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  if (existing.isArchived === 1) {
    return c.json({ success: true, data: serializeProject(existing) })
  }
  const [row] = await db
    .update(projectsTable)
    .set({ isArchived: 1 })
    .where(eq(projectsTable.id, existing.id))
    .returning()
  await invalidateProjectCache(existing.id, existing.alias)
  logger.info({ projectId: existing.id }, 'project_archived')
  return c.json({ success: true, data: serializeProject(row!) })
})

projects.post('/:projectId/unarchive', async (c) => {
  const existing = await findProject(c.req.param('projectId'))
  if (!existing) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  if (existing.isArchived === 0) {
    return c.json({ success: true, data: serializeProject(existing) })
  }
  const [row] = await db
    .update(projectsTable)
    .set({ isArchived: 0 })
    .where(eq(projectsTable.id, existing.id))
    .returning()
  await invalidateProjectCache(existing.id, existing.alias)
  logger.info({ projectId: existing.id }, 'project_unarchived')
  return c.json({ success: true, data: serializeProject(row!) })
})

export default projects
