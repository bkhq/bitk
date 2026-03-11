import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { cacheDel, cacheGet, cacheGetOrSet, cacheSet } from '@/cache'
import { db } from '.'
import {
  appSettings as appSettingsTable,
  issues as issuesTable,
  projects as projectsTable,
} from './schema'

type ProjectRow = typeof projectsTable.$inferSelect

const PROJECT_CACHE_TTL = 60 // seconds

export async function findProject(param: string) {
  // Check cache first (param could be ID or alias)
  const cacheKey = `project:lookup:${param}`
  const cached = await cacheGet<ProjectRow>(cacheKey)
  if (cached) return cached

  // Single query: match by ID or alias
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        sql`(${projectsTable.id} = ${param} OR ${projectsTable.alias} = ${param})`,
        eq(projectsTable.isDeleted, 0),
      ),
    )

  if (row) {
    // Cache under both ID and alias keys
    await cacheSet(`project:lookup:${row.id}`, row, PROJECT_CACHE_TTL)
    if (row.alias) {
      await cacheSet(`project:lookup:${row.alias}`, row, PROJECT_CACHE_TTL)
    }
  }

  return row
}

export async function invalidateProjectCache(id: string, alias?: string | null): Promise<void> {
  await cacheDel(`project:lookup:${id}`)
  if (alias) {
    await cacheDel(`project:lookup:${alias}`)
  }
}

/**
 * Mark stale issues with active sessions (running/pending) as failed on startup.
 * These represent sessions that were active when the server was last shut down.
 * Returns the number of issues cleaned up.
 */
export async function cleanupStaleSessions(): Promise<number> {
  const staleStatuses = ['running', 'pending']

  // Find issues with stale session status
  const staleIssues = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(inArray(issuesTable.sessionStatus, staleStatuses), eq(issuesTable.isDeleted, 0)))

  if (staleIssues.length === 0) return 0

  const issueIds = staleIssues.map(s => s.id)

  // Mark stale issue sessions as failed
  await db
    .update(issuesTable)
    .set({ sessionStatus: 'failed' })
    .where(inArray(issuesTable.id, issueIds))

  return staleIssues.length
}

// --- App Settings helpers ---

const SETTINGS_CACHE_TTL = 3600 // seconds

export async function getAppSetting(key: string): Promise<string | null> {
  return cacheGetOrSet(`app_setting:${key}`, SETTINGS_CACHE_TTL, async () => {
    const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key))
    return row?.value ?? null
  })
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    })

  await cacheDel(`app_setting:${key}`)
}

export async function getEngineDefaultModel(engineType: string): Promise<string | null> {
  return getAppSetting(`engine:${engineType}:defaultModel`)
}

export async function setEngineDefaultModel(engineType: string, modelId: string): Promise<void> {
  await setAppSetting(`engine:${engineType}:defaultModel`, modelId)
  await cacheDel('engineDefaultModels:all')
}

export async function getDefaultEngine(): Promise<string | null> {
  return getAppSetting('defaultEngine')
}

export async function setDefaultEngine(engineType: string): Promise<void> {
  return setAppSetting('defaultEngine', engineType)
}

export async function getAllEngineDefaultModels(): Promise<Record<string, string>> {
  return cacheGetOrSet('engineDefaultModels:all', SETTINGS_CACHE_TTL, async () => {
    const rows = await db
      .select({ key: appSettingsTable.key, value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(sql`${appSettingsTable.key} LIKE 'engine:%:defaultModel'`)
    const result: Record<string, string> = {}
    const prefix = 'engine:'
    const suffix = ':defaultModel'
    for (const row of rows) {
      const engineType = row.key.slice(prefix.length, -suffix.length)
      result[engineType] = row.value
    }
    return result
  })
}

// --- Probe Results persistence ---

interface ProbeData {
  engines: import('../engines/types').EngineAvailability[]
  models: Record<string, import('../engines/types').EngineModel[]>
}

const PROBE_ENGINES_KEY = 'probe:engines'
const PROBE_MODELS_KEY = 'probe:models'

export async function getProbeResults(): Promise<ProbeData | null> {
  const [enginesJson, modelsJson] = await Promise.all([
    getAppSetting(PROBE_ENGINES_KEY),
    getAppSetting(PROBE_MODELS_KEY),
  ])

  if (!enginesJson || !modelsJson) return null

  try {
    return {
      engines: JSON.parse(enginesJson),
      models: JSON.parse(modelsJson),
    }
  } catch {
    return null
  }
}

export async function saveProbeResults(
  engines: import('../engines/types').EngineAvailability[],
  models: Record<string, import('../engines/types').EngineModel[]>,
): Promise<void> {
  await Promise.all([
    setAppSetting(PROBE_ENGINES_KEY, JSON.stringify(engines)),
    setAppSetting(PROBE_MODELS_KEY, JSON.stringify(models)),
  ])
}

// --- Write Filter default rules seeding ---

export async function ensureDefaultFilterRules(): Promise<void> {
  const { WRITE_FILTER_RULES_KEY, DEFAULT_FILTER_RULES } = await import('../engines/write-filter')
  const existing = await getAppSetting(WRITE_FILTER_RULES_KEY)
  if (!existing) {
    await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(DEFAULT_FILTER_RULES))
  }
}

// --- Server Info ---

const SERVER_NAME_KEY = 'server:name'
const SERVER_URL_KEY = 'server:url'

export async function getServerName(): Promise<string | null> {
  return getAppSetting(SERVER_NAME_KEY)
}

export async function getServerUrl(): Promise<string | null> {
  return getAppSetting(SERVER_URL_KEY)
}

export async function setServerName(value: string): Promise<void> {
  await setAppSetting(SERVER_NAME_KEY, value)
}

export async function setServerUrl(value: string): Promise<void> {
  await setAppSetting(SERVER_URL_KEY, value)
}

export async function deleteAppSetting(key: string): Promise<void> {
  await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key))
  await cacheDel(`app_setting:${key}`)
}

/**
 * On startup: if DB has no server name/url but env vars are set, migrate them.
 */
export async function ensureServerInfoDefaults(): Promise<void> {
  const envName = process.env.SERVER_NAME?.trim()
  const envUrl = process.env.SERVER_URL?.trim()

  if (envName) {
    const existing = await getAppSetting(SERVER_NAME_KEY)
    if (!existing) {
      await setAppSetting(SERVER_NAME_KEY, envName)
    }
  }

  if (envUrl) {
    const existing = await getAppSetting(SERVER_URL_KEY)
    if (!existing) {
      await setAppSetting(SERVER_URL_KEY, envUrl)
    }
  }
}

// --- Sort order backfill ---

/**
 * On startup: assign sequential sortOrders to projects and issues
 * that still have the default 'a0', preserving their current DB order
 * (createdAt ASC). Only runs once — skips if any row already has a
 * non-default sortOrder.
 */
export async function backfillSortOrders(): Promise<void> {
  // Backfill projects
  const allProjects = await db
    .select({ id: projectsTable.id, sortOrder: projectsTable.sortOrder })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, false))
    .orderBy(asc(projectsTable.createdAt))

  const projectsNeedBackfill = allProjects.length > 1
    && allProjects.every(p => p.sortOrder === 'a0')

  if (projectsNeedBackfill) {
    let cursor: string | null = null
    for (const project of allProjects) {
      const key = generateKeyBetween(cursor, null)
      cursor = key
      await db.update(projectsTable)
        .set({ sortOrder: key })
        .where(eq(projectsTable.id, project.id))
    }
  }

  // Backfill issues per project
  const projectIds = allProjects.map(p => p.id)
  for (const projectId of projectIds) {
    const issues = await db
      .select({ id: issuesTable.id, sortOrder: issuesTable.sortOrder, statusId: issuesTable.statusId })
      .from(issuesTable)
      .where(and(eq(issuesTable.projectId, projectId), eq(issuesTable.isDeleted, false)))
      .orderBy(asc(issuesTable.createdAt))

    const needsBackfill = issues.length > 1
      && issues.every(i => i.sortOrder === 'a0')

    if (!needsBackfill) continue

    // Group by status column, assign within each group
    const byStatus: Record<string, typeof issues> = {}
    for (const issue of issues) {
      ;(byStatus[issue.statusId] ??= []).push(issue)
    }

    for (const group of Object.values(byStatus)) {
      let cursor: string | null = null
      for (const issue of group) {
        const key = generateKeyBetween(cursor, null)
        cursor = key
        await db.update(issuesTable)
          .set({ sortOrder: key })
          .where(eq(issuesTable.id, issue.id))
      }
    }
  }
}

// --- Worktree auto-cleanup default seeding ---

export async function ensureWorktreeAutoCleanupDefault(): Promise<void> {
  const { WORKTREE_AUTO_CLEANUP_KEY } = await import('../jobs/worktree-cleanup')
  const existing = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  if (existing === null) {
    await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, 'true')
  }
}
