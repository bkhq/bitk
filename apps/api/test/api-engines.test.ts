import { describe, expect, test } from 'bun:test'
import { expectError, expectSuccess, get, post } from './helpers'
/**
 * Engines API tests.
 */
import './setup'

describe('GET /api/engines/available', () => {
  test('returns engines and models', async () => {
    const result = await get<{ engines: unknown[]; models: Record<string, unknown[]> }>(
      '/api/engines/available',
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data.engines)).toBe(true)
    expect(typeof data.models).toBe('object')
  }, 30_000)
})

describe('GET /api/engines/profiles', () => {
  test('returns engine profiles array', async () => {
    const result = await get<unknown[]>('/api/engines/profiles')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)

    // Each profile should have an engineType and name
    const profile = data[0] as Record<string, unknown>
    expect(profile.engineType).toBeTruthy()
    expect(profile.name).toBeTruthy()
  })
})

describe('GET /api/engines/settings', () => {
  test('returns default engine and per-engine settings', async () => {
    const result = await get<{ defaultEngine: string | null; engines: Record<string, unknown> }>(
      '/api/engines/settings',
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(typeof data.engines).toBe('object')
    // defaultEngine may be null initially
    expect('defaultEngine' in data).toBe(true)
  })
})

describe('POST /api/engines/default-engine', () => {
  test('sets a valid default engine', async () => {
    const result = await post<{ defaultEngine: string }>('/api/engines/default-engine', {
      defaultEngine: 'echo',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.defaultEngine).toBe('echo')
  })

  test('rejects invalid engine type', async () => {
    const result = await post<unknown>('/api/engines/default-engine', {
      defaultEngine: 'nonexistent',
    })
    expect(result.status).toBe(400)
  })

  test('rejects missing body', async () => {
    const result = await post<unknown>('/api/engines/default-engine', {})
    expect(result.status).toBe(400)
  })
})

describe('GET /api/engines/:engineType/models', () => {
  test('returns models for a valid engine type', async () => {
    const result = await get<{
      engineType: string
      defaultModel: string | undefined
      models: unknown[]
    }>('/api/engines/echo/models')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.engineType).toBe('echo')
    expect(Array.isArray(data.models)).toBe(true)
  })

  test('returns 400 for invalid engine type', async () => {
    const result = await get<unknown>('/api/engines/nonexistent/models')
    expect(result.status).toBe(400)
    expectError(result, 400)
  })
})

describe('POST /api/engines/probe', () => {
  test('forces a re-probe and returns result', async () => {
    const result = await post<{
      engines: unknown[]
      models: Record<string, unknown[]>
      duration: number
    }>('/api/engines/probe', {})
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data.engines)).toBe(true)
    expect(typeof data.models).toBe('object')
    expect(typeof data.duration).toBe('number')
  }, 30_000) // Probe runs per-engine timeouts up to 15s each
})
