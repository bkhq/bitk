import { and, eq, inArray } from 'drizzle-orm'
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

  // Try by ID first, then by alias
  let [row] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, param), eq(projectsTable.isDeleted, 0)))
  if (!row) {
    ;[row] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.alias, param), eq(projectsTable.isDeleted, 0)))
  }

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

  const issueIds = staleIssues.map((s) => s.id)

  // Mark stale issue sessions as failed
  await db
    .update(issuesTable)
    .set({ sessionStatus: 'failed' })
    .where(inArray(issuesTable.id, issueIds))

  return staleIssues.length
}

// --- App Settings helpers ---

const SETTINGS_CACHE_TTL = 300 // seconds

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
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } })

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
    const rows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.isDeleted, 0))
    const result: Record<string, string> = {}
    const prefix = 'engine:'
    const suffix = ':defaultModel'
    for (const row of rows) {
      if (row.key.startsWith(prefix) && row.key.endsWith(suffix)) {
        const engineType = row.key.slice(prefix.length, -suffix.length)
        result[engineType] = row.value
      }
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
