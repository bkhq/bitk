import { describe, expect, test } from 'bun:test'
import { expectError, expectSuccess, get, patch } from './helpers'
/**
 * Settings API tests.
 */
import './setup'

describe('GET /api/settings/workspace-path', () => {
  test('returns current workspace path', async () => {
    const result = await get<{ path: string }>('/api/settings/workspace-path')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(typeof data.path).toBe('string')
    // Default path is '/' when no setting has been saved
    expect(data.path).toBeTruthy()
  })
})

describe('PATCH /api/settings/workspace-path', () => {
  test('sets a valid workspace path', async () => {
    const result = await patch<{ path: string }>('/api/settings/workspace-path', {
      path: '/tmp',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.path).toBe('/tmp')
  })

  test('persists workspace path across reads', async () => {
    // Set path
    await patch<{ path: string }>('/api/settings/workspace-path', {
      path: '/tmp',
    })
    // Read it back
    const result = await get<{ path: string }>('/api/settings/workspace-path')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.path).toBe('/tmp')
  })

  test('rejects non-existent path', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {
      path: '/nonexistent/path/that/does/not/exist',
    })
    expect(result.status).toBe(400)
    expectError(result, 400)
  })

  test('rejects empty path', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {
      path: '',
    })
    expect(result.status).toBe(400)
  })

  test('rejects missing path field', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {})
    expect(result.status).toBe(400)
  })
})
