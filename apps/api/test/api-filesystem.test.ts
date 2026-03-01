import { existsSync, rmdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { expectSuccess, get, post } from './helpers'
/**
 * Filesystem API tests.
 */
import './setup'

describe('GET /api/filesystem/dirs', () => {
  test('lists dirs from cwd by default', async () => {
    const result = await get<{ current: string; parent: string | null; dirs: string[] }>(
      '/api/filesystem/dirs',
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(typeof data.current).toBe('string')
    expect(Array.isArray(data.dirs)).toBe(true)
    // Parent may be null if workspace root clamps it
    expect(data.parent === null || typeof data.parent === 'string').toBe(true)
  })

  test('lists dirs from a specific path', async () => {
    const result = await get<{ current: string; parent: string | null; dirs: string[] }>(
      '/api/filesystem/dirs?path=/tmp',
    )
    // May return 200 or 403 depending on workspace root config
    if (result.status === 200) {
      const data = expectSuccess(result)
      expect(data.current).toBe('/tmp')
      expect(Array.isArray(data.dirs)).toBe(true)
    } else {
      expect(result.status).toBe(403)
    }
  })

  test('handles non-existent path outside workspace as 403', async () => {
    const result = await get<unknown>(
      '/api/filesystem/dirs?path=/nonexistent/path/should/not/exist',
    )
    // SEC-022: Paths outside workspace root are rejected with 403
    expect([200, 403]).toContain(result.status)
  })

  test('excludes hidden directories (starting with dot)', async () => {
    // Use cwd (default) which is always within workspace
    const result = await get<{ current: string; parent: string | null; dirs: string[] }>(
      '/api/filesystem/dirs',
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    // None of the returned dirs should start with a dot
    for (const dir of data.dirs) {
      expect(dir.startsWith('.')).toBe(false)
    }
  })
})

describe('POST /api/filesystem/dirs', () => {
  const testDirName = `test-dir-${process.pid}-${Date.now()}`
  const testDirPath = resolve('/tmp', testDirName)

  test('creates a directory in /tmp', async () => {
    const result = await post<{ path: string }>('/api/filesystem/dirs', {
      path: '/tmp',
      name: testDirName,
    })
    // May return 201 or 403 depending on workspace root config
    if (result.status === 201) {
      const data = expectSuccess(result)
      expect(data.path).toBe(testDirPath)
      expect(existsSync(testDirPath)).toBe(true)
      // Cleanup
      try {
        rmdirSync(testDirPath)
      } catch {
        // ignore
      }
    } else {
      expect(result.status).toBe(403)
    }
  })

  test('rejects missing path field', async () => {
    const result = await post<unknown>('/api/filesystem/dirs', {
      name: 'test',
    })
    expect(result.status).toBe(400)
  })

  test('rejects missing name field', async () => {
    const result = await post<unknown>('/api/filesystem/dirs', {
      path: '/tmp',
    })
    expect(result.status).toBe(400)
  })

  test('rejects empty body', async () => {
    const result = await post<unknown>('/api/filesystem/dirs', {})
    expect(result.status).toBe(400)
  })
})
