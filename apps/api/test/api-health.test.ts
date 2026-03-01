import { describe, expect, test } from 'bun:test'
import { expectSuccess, get } from './helpers'
/**
 * Health & infrastructure API tests.
 */
import './setup'

describe('GET /api', () => {
  test('returns API info in standard envelope', async () => {
    const result = await get<{ name: string; status: string }>('/api')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.name).toBe('bitk-api')
    expect(data.status).toBe('ok')
  })
})

describe('GET /api/health', () => {
  test('returns health status with DB check', async () => {
    const result = await get<{ status: string; db: string; timestamp: string }>(
      '/api/health',
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.status).toBe('ok')
    expect(data.db).toBe('ok')
    expect(typeof data.timestamp).toBe('string')
  })
})

describe('404 handler', () => {
  test('returns 404 for unknown API routes', async () => {
    const result = await get<unknown>('/api/nonexistent')
    expect(result.status).toBe(404)
  })
})
