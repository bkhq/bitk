import { beforeEach, describe, expect, test } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { cacheDel, cacheDelByPrefix } from '../src/cache'
import { db } from '../src/db'
import { appSettings as appSettingsTable } from '../src/db/schema'
import { engineRegistry } from '../src/engines/executors'
import { getEngineDiscovery } from '../src/engines/startup-probe'
import type { EngineExecutor } from '../src/engines/types'
import './setup'

async function clearProbeState(): Promise<void> {
  await cacheDel('engines:available')
  await cacheDelByPrefix('engines:models:')
  await db
    .delete(appSettingsTable)
    .where(inArray(appSettingsTable.key, ['probe:engines', 'probe:models']))
}

describe('startup probe deep behavior', () => {
  beforeEach(async () => {
    await clearProbeState()
  })

  test('deduplicates concurrent live probes into a single executor probe', async () => {
    let availabilityCalls = 0
    let modelsCalls = 0

    const fakeExecutor: EngineExecutor = {
      engineType: 'echo',
      protocol: 'stream-json',
      capabilities: [],
      spawn: async () => {
        throw new Error('not used in probe test')
      },
      spawnFollowUp: async () => {
        throw new Error('not used in probe test')
      },
      cancel: async () => {},
      normalizeLog: () => null,
      getAvailability: async () => {
        availabilityCalls += 1
        await Bun.sleep(30)
        return {
          engineType: 'echo',
          installed: true,
          authStatus: 'authenticated',
        }
      },
      getModels: async () => {
        modelsCalls += 1
        await Bun.sleep(30)
        return [{ id: 'auto', name: 'Auto', isDefault: true }]
      },
    }

    const originalGetAll = engineRegistry.getAll.bind(engineRegistry)
    ;(engineRegistry as any).getAll = () => [fakeExecutor]

    try {
      const [a, b, c] = await Promise.all([
        getEngineDiscovery(),
        getEngineDiscovery(),
        getEngineDiscovery(),
      ])

      expect(availabilityCalls).toBe(1)
      expect(modelsCalls).toBe(1)
      expect(a.engines[0]?.engineType).toBe('echo')
      expect(b.models.echo?.length).toBe(1)
      expect(c.models.echo?.[0]?.id).toBe('auto')

      // Subsequent call should hit memory cache and avoid another live probe.
      await getEngineDiscovery()
      expect(availabilityCalls).toBe(1)
      expect(modelsCalls).toBe(1)
    } finally {
      ;(engineRegistry as any).getAll = originalGetAll
      await clearProbeState()
    }
  })

  test('after clearing cache and DB, a new call runs a fresh live probe', async () => {
    let availabilityCalls = 0
    let modelsCalls = 0

    const fakeExecutor: EngineExecutor = {
      engineType: 'echo',
      protocol: 'stream-json',
      capabilities: [],
      spawn: async () => {
        throw new Error('not used in probe test')
      },
      spawnFollowUp: async () => {
        throw new Error('not used in probe test')
      },
      cancel: async () => {},
      normalizeLog: () => null,
      getAvailability: async () => {
        availabilityCalls += 1
        return {
          engineType: 'echo',
          installed: true,
          authStatus: 'authenticated',
        }
      },
      getModels: async () => {
        modelsCalls += 1
        return [{ id: 'auto', name: 'Auto', isDefault: true }]
      },
    }

    const originalGetAll = engineRegistry.getAll.bind(engineRegistry)
    ;(engineRegistry as any).getAll = () => [fakeExecutor]

    try {
      await getEngineDiscovery()
      expect(availabilityCalls).toBe(1)
      expect(modelsCalls).toBe(1)

      await clearProbeState()
      await getEngineDiscovery()
      expect(availabilityCalls).toBe(2)
      expect(modelsCalls).toBe(2)
    } finally {
      ;(engineRegistry as any).getAll = originalGetAll
      await clearProbeState()
    }
  })
})
