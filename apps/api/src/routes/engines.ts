import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import {
  getAllEngineDefaultModels,
  getDefaultEngine,
  setDefaultEngine,
  setEngineDefaultModel,
} from '@/db/helpers'
import { engineRegistry } from '@/engines/executors'
import {
  forceProbeEngines,
  getEngineDiscovery,
  getEngineModels,
} from '@/engines/startup-probe'
import { BUILT_IN_PROFILES } from '@/engines/types'

const ENGINE_TYPES = ['claude-code', 'codex', 'gemini', 'echo'] as const
const engineTypeEnum = z.enum(ENGINE_TYPES)

const engines = new Hono()

// GET /api/engines/available — List detected engines + models (cache → DB → live probe)
engines.get('/available', async (c) => {
  const { engines, models } = await getEngineDiscovery()
  return c.json({ success: true, data: { engines, models } })
})

// GET /api/engines/profiles — List engine profiles
engines.get('/profiles', (c) => {
  const profiles = Object.values(BUILT_IN_PROFILES)
  return c.json({ success: true, data: profiles })
})

// GET /api/engines/settings — Get all engine settings (default engine + per-engine default models)
engines.get('/settings', async (c) => {
  const [defaults, defaultEngine] = await Promise.all([
    getAllEngineDefaultModels(),
    getDefaultEngine(),
  ])
  const engines: Record<string, { defaultModel: string }> = {}
  for (const [engineType, model] of Object.entries(defaults)) {
    engines[engineType] = { defaultModel: model }
  }
  return c.json({ success: true, data: { defaultEngine, engines } })
})

// POST /api/engines/default-engine — Update global default engine
engines.post(
  '/default-engine',
  zValidator('json', z.object({ defaultEngine: engineTypeEnum })),
  async (c) => {
    const { defaultEngine } = c.req.valid('json')
    await setDefaultEngine(defaultEngine)
    return c.json({ success: true, data: { defaultEngine } })
  },
)

// PATCH /api/engines/:engineType/settings — Upsert default model for an engine type
engines.patch(
  '/:engineType/settings',
  zValidator('json', z.object({ defaultModel: z.string().min(1) })),
  async (c) => {
    const rawType = c.req.param('engineType')
    const parsed = engineTypeEnum.safeParse(rawType)
    if (!parsed.success) {
      return c.json(
        { success: false, error: `Unknown engine type: ${rawType}` },
        400,
      )
    }
    const engineType = parsed.data
    const { defaultModel } = c.req.valid('json')
    await setEngineDefaultModel(engineType, defaultModel)
    return c.json({ success: true, data: { engineType, defaultModel } })
  },
)

// GET /api/engines/:engineType/models — List available models for an engine
engines.get('/:engineType/models', async (c) => {
  const rawType = c.req.param('engineType')
  const parsed = engineTypeEnum.safeParse(rawType)
  if (!parsed.success) {
    return c.json(
      { success: false, error: `Unknown engine type: ${rawType}` },
      400,
    )
  }
  const engineType = parsed.data
  const executor = engineRegistry.get(engineType)
  if (!executor) {
    return c.json(
      { success: false, error: `Unknown engine type: ${engineType}` },
      404,
    )
  }

  const models = await getEngineModels(engineType)
  const defaultModel = models.find((m) => m.isDefault)?.id

  return c.json({
    success: true,
    data: { engineType, defaultModel, models },
  })
})

// POST /api/engines/probe — Force a live re-probe of all engines
engines.post('/probe', async (c) => {
  const result = await forceProbeEngines()
  return c.json({ success: true, data: result })
})

export default engines
