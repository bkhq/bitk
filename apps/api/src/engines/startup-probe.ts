import type { EngineAvailability, EngineModel, EngineType } from './types'
import { cacheGet, cacheSet } from '@/cache'
import { getProbeResults, saveProbeResults } from '@/db/helpers'
import { logger } from '@/logger'
import { engineRegistry } from './executors'

// Cache keys
const CACHE_KEY_ENGINES = 'engines:available'
const CACHE_KEY_MODELS_PREFIX = 'engines:models:'
const PROBE_TTL = 600 // 10 minutes

export interface ProbeResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
  duration: number
}

export interface EngineDiscovery {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
}

/**
 * Write probe results to memory cache.
 */
async function writeToCache(
  engines: EngineAvailability[],
  models: Record<string, EngineModel[]>,
): Promise<void> {
  await cacheSet(CACHE_KEY_ENGINES, engines, PROBE_TTL)
  for (const [engineType, engineModels] of Object.entries(models)) {
    await cacheSet(`${CACHE_KEY_MODELS_PREFIX}${engineType}`, engineModels, PROBE_TTL)
  }
}

/**
 * Read from memory cache. Returns null if cache is empty.
 */
async function readFromCache(): Promise<EngineDiscovery | null> {
  const engines = await cacheGet<EngineAvailability[]>(CACHE_KEY_ENGINES)
  if (!engines) return null

  const models: Record<string, EngineModel[]> = {}
  for (const engine of engines) {
    if (!engine.installed) continue
    const cached = await cacheGet<EngineModel[]>(`${CACHE_KEY_MODELS_PREFIX}${engine.engineType}`)
    if (cached && cached.length > 0) {
      models[engine.engineType] = cached
    }
  }

  return { engines, models }
}

// Per-engine probe timeout (prevents a single engine from blocking the entire probe)
const PER_ENGINE_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

/**
 * Run live probe against all registered engine executors.
 * Each engine probe has a per-engine timeout to prevent hangs.
 */
async function runLiveProbe(): Promise<EngineDiscovery> {
  const executors = engineRegistry.getAll()
  const engines: EngineAvailability[] = []
  const models: Record<string, EngineModel[]> = {}

  const results = await Promise.allSettled(
    executors.map(async (executor) => {
      const [availability, engineModels] = await Promise.all([
        withTimeout(executor.getAvailability(), PER_ENGINE_TIMEOUT_MS, executor.engineType),
        withTimeout(executor.getModels(), PER_ENGINE_TIMEOUT_MS, `${executor.engineType}:models`),
      ])
      return { availability, models: engineModels }
    }),
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const executor = executors[i]
    if (!result || !executor) continue
    if (result.status !== 'fulfilled') {
      const rejected = result as PromiseRejectedResult
      const engineType = executor.engineType
      logger.warn(
        { engineType, error: rejected.reason?.message ?? String(rejected.reason) },
        'probe_engine_failed',
      )
      // Return a safe fallback for timed-out / failed probes
      engines.push({
        engineType,
        installed: false,
        authStatus: 'unknown',
        error: rejected.reason?.message,
      })
      continue
    }

    const fulfilled = result as PromiseFulfilledResult<{
      availability: EngineAvailability
      models: EngineModel[]
    }>
    const { availability, models: engineModels } = fulfilled.value
    engines.push(availability)

    if (availability.installed && engineModels.length > 0) {
      models[availability.engineType] = engineModels
    }

    const defaultModel = engineModels.find((m: EngineModel) => m.isDefault)
    logger.debug(
      {
        engineType: availability.engineType,
        installed: availability.installed,
        version: availability.version ?? null,
        models: engineModels.length,
        defaultModel: defaultModel?.id ?? null,
      },
      'probe_engine_done',
    )
  }

  return { engines, models }
}

/**
 * Unified entry point for getting engine data.
 * Lookup order: memory cache → DB → live probe.
 * Results are persisted to both DB and memory cache.
 *
 * Used by both the API route and startup.
 */
export async function getEngineDiscovery(): Promise<EngineDiscovery> {
  // 1. Memory cache
  const cached = await readFromCache()
  if (cached) return cached

  // 2. DB
  const dbData = await getProbeResults()
  if (dbData) {
    logger.debug(
      {
        engines: dbData.engines.length,
        modelsDiscovered: Object.keys(dbData.models).length,
      },
      'probe_loaded_from_db',
    )
    await writeToCache(dbData.engines, dbData.models)
    return dbData
  }

  // 3. Live probe
  logger.info('probe_started')
  const start = Date.now()
  const discovery = await runLiveProbe()

  await Promise.all([
    writeToCache(discovery.engines, discovery.models),
    saveProbeResults(discovery.engines, discovery.models),
  ])

  logger.info(
    {
      duration: `${Date.now() - start}ms`,
      engines: discovery.engines.length,
      modelsDiscovered: Object.keys(discovery.models).length,
    },
    'probe_completed',
  )

  return discovery
}

/**
 * Force a live re-probe, ignoring cache and DB. Saves fresh results everywhere.
 */
export async function forceProbeEngines(): Promise<ProbeResult> {
  const start = Date.now()
  logger.info('force_probe_started')

  const { engines, models } = await runLiveProbe()

  await Promise.all([writeToCache(engines, models), saveProbeResults(engines, models)])

  const duration = Date.now() - start
  logger.info(
    {
      duration: `${duration}ms`,
      engines: engines.length,
      modelsDiscovered: Object.keys(models).length,
    },
    'force_probe_completed',
  )

  return { engines, models, duration }
}

/**
 * Get cached models for a specific engine type. Falls back to live query.
 */
export async function getEngineModels(engineType: EngineType): Promise<EngineModel[]> {
  const cached = await cacheGet<EngineModel[]>(`${CACHE_KEY_MODELS_PREFIX}${engineType}`)
  if (cached) return cached

  return engineRegistry.getModels(engineType)
}
