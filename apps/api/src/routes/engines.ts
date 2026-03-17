import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import {
  getAllEngineDefaultModels,
  getAllEngineHiddenModels,
  getDefaultEngine,
  setDefaultEngine,
  setEngineDefaultModel,
  setEngineHiddenModels,
} from '@/db/helpers'
import { engineRegistry } from '@/engines/executors'
import { getAcpAgents } from '@/engines/executors/acp/agents'
import { forceProbeEngines, getEngineDiscovery, getEngineModels, toAcpEngineType } from '@/engines/startup-probe'
import type { EngineProfile } from '@/engines/types'
import { BUILT_IN_PROFILES } from '@/engines/types'

const ENGINE_TYPES = ['claude-code', 'codex', 'acp'] as const

/** Accept both base engine types and virtual ACP types (e.g. "acp:codex") */
const engineTypeOrAcpEnum = z.string().refine(
  val => ENGINE_TYPES.includes(val as typeof ENGINE_TYPES[number]) || val.startsWith('acp:'),
  { message: 'Invalid engine type' },
)

const engines = new Hono()

// GET /api/engines/available — List detected engines + models (cache → DB → live probe)
engines.get('/available', async (c) => {
  const { engines, models } = await getEngineDiscovery()
  return c.json({ success: true, data: { engines, models } })
})

// GET /api/engines/profiles — List engine profiles (ACP expanded into per-agent profiles)
engines.get('/profiles', (c) => {
  const baseProfiles = Object.values(BUILT_IN_PROFILES)
  const acpProfile = BUILT_IN_PROFILES.acp
  const agents = getAcpAgents()

  // Replace the single ACP profile with per-agent profiles
  const profiles: EngineProfile[] = [
    ...baseProfiles.filter(p => p.engineType !== 'acp'),
    ...agents.map(agent => ({
      ...acpProfile,
      engineType: toAcpEngineType(agent.id) as EngineProfile['engineType'],
      name: `ACP: ${agent.label}`,
    })),
  ]

  return c.json({ success: true, data: profiles })
})

// GET /api/engines/settings — Get all engine settings (default engine + per-engine models + hidden)
engines.get('/settings', async (c) => {
  const [defaults, hiddenModels, defaultEngine] = await Promise.all([
    getAllEngineDefaultModels(),
    getAllEngineHiddenModels(),
    getDefaultEngine(),
  ])
  const engines: Record<string, { defaultModel?: string, hiddenModels?: string[] }> = {}
  for (const [engineType, model] of Object.entries(defaults)) {
    engines[engineType] = { ...engines[engineType], defaultModel: model }
  }
  for (const [engineType, hidden] of Object.entries(hiddenModels)) {
    engines[engineType] = { ...engines[engineType], hiddenModels: hidden }
  }
  return c.json({ success: true, data: { defaultEngine, engines } })
})

// PATCH /api/engines/default-engine — Update global default engine
engines.patch(
  '/default-engine',
  zValidator('json', z.object({ defaultEngine: engineTypeOrAcpEnum }), (result, c) => {
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
    const { defaultEngine } = c.req.valid('json')
    await setDefaultEngine(defaultEngine)
    return c.json({ success: true, data: { defaultEngine } })
  },
)

// PATCH /api/engines/:engineType/settings — Upsert default model for an engine type
engines.patch(
  '/:engineType/settings',
  zValidator('json', z.object({ defaultModel: z.string().min(1) }), (result, c) => {
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
    const rawType = c.req.param('engineType')
    const parsed = engineTypeOrAcpEnum.safeParse(rawType)
    if (!parsed.success) {
      return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400)
    }
    const engineType = parsed.data
    const { defaultModel } = c.req.valid('json')
    await setEngineDefaultModel(engineType, defaultModel)
    return c.json({ success: true, data: { engineType, defaultModel } })
  },
)

// PATCH /api/engines/:engineType/hidden-models — Update hidden models for an engine type
engines.patch(
  '/:engineType/hidden-models',
  zValidator('json', z.object({ hiddenModels: z.array(z.string()) }), (result, c) => {
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
    const rawType = c.req.param('engineType')
    const parsed = engineTypeOrAcpEnum.safeParse(rawType)
    if (!parsed.success) {
      return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400)
    }
    const engineType = parsed.data
    const { hiddenModels } = c.req.valid('json')
    await setEngineHiddenModels(engineType, hiddenModels)
    return c.json({ success: true, data: { engineType, hiddenModels } })
  },
)

// GET /api/engines/:engineType/models — List available models for an engine
engines.get('/:engineType/models', async (c) => {
  const rawType = c.req.param('engineType')
  const parsed = engineTypeOrAcpEnum.safeParse(rawType)
  if (!parsed.success) {
    return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400)
  }
  const engineType = parsed.data
  // For virtual ACP types, resolve to base 'acp' executor
  const lookupType = engineType.startsWith('acp:') ? 'acp' : engineType
  const executor = engineRegistry.get(lookupType as typeof ENGINE_TYPES[number])
  if (!executor) {
    return c.json({ success: false, error: `Unknown engine type: ${engineType}` }, 404)
  }

  const allModels = await getEngineModels(lookupType as typeof ENGINE_TYPES[number])
  // For virtual ACP types, filter to only models matching the agent prefix
  const models = engineType.startsWith('acp:')
    ? allModels.filter(m => m.id.startsWith(`${engineType}:`))
    : allModels
  const defaultModel = models.find(m => m.isDefault)?.id

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
