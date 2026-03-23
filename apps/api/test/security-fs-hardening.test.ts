import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { get, post } from './helpers'
import app from '@/app'
import './setup'

/**
 * Security hardening tests for file system and git routes.
 * Covers SEC-007, SEC-008, SEC-009, SEC-030.
 */

const tmpBase = resolve('/tmp', `bkd-sec-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')
const outsideDir = resolve(tmpBase, 'outside')

beforeAll(async () => {
  // Create test directory structure
  mkdirSync(resolve(workspaceDir, 'subdir'), { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  // Create test files
  writeFileSync(resolve(workspaceDir, 'test.txt'), 'hello workspace')
  writeFileSync(resolve(workspaceDir, 'subdir', 'nested.txt'), 'nested file')
  writeFileSync(resolve(outsideDir, 'secret.txt'), 'secret data')

  // Create symlink inside workspace pointing outside
  symlinkSync(outsideDir, resolve(workspaceDir, 'escape-link'))

  // Set workspace root
  await setAppSetting('workspace:defaultPath', workspaceDir)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  // Clean up
  rmSync(tmpBase, { recursive: true, force: true })

  // Reset workspace setting
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('SEC-007: /api/files/show root parameter workspace validation', () => {
  test('allows root within workspace', async () => {
    const result = await get<unknown>(
      `/api/files/show?root=${encodeURIComponent(workspaceDir)}`,
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
  })

  test('rejects root outside workspace', async () => {
    const result = await get<unknown>(
      `/api/files/show?root=${encodeURIComponent(outsideDir)}`,
    )
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('rejects root parameter with path traversal', async () => {
    const traversal = resolve(workspaceDir, '..', 'outside')
    const result = await get<unknown>(
      `/api/files/show?root=${encodeURIComponent(traversal)}`,
    )
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })
})

describe('SEC-008: /api/files/raw symlink verification', () => {
  test('serves files within workspace normally', async () => {
    const url = `http://localhost/api/files/raw/test.txt?root=${encodeURIComponent(workspaceDir)}`
    const res = await app.request(url)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('hello workspace')
  })

  test('rejects raw access via symlink escaping workspace', async () => {
    const url = `http://localhost/api/files/raw/escape-link/secret.txt?root=${encodeURIComponent(workspaceDir)}`
    const res = await app.request(url)
    expect(res.status).toBe(403)
  })
})

describe('SEC-009: /api/files/show symlink verification', () => {
  test('shows files within workspace normally', async () => {
    const result = await get<unknown>(
      `/api/files/show/test.txt?root=${encodeURIComponent(workspaceDir)}`,
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
  })

  test('rejects show via symlink escaping workspace', async () => {
    const result = await get<unknown>(
      `/api/files/show/escape-link/secret.txt?root=${encodeURIComponent(workspaceDir)}`,
    )
    expect(result.status).toBe(403)
  })

  test('rejects directory listing via symlink escaping workspace', async () => {
    const result = await get<unknown>(
      `/api/files/show/escape-link?root=${encodeURIComponent(workspaceDir)}`,
    )
    expect(result.status).toBe(403)
  })
})

describe('SEC-030: /api/git/detect-remote workspace validation', () => {
  test('rejects directory outside workspace', async () => {
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: outsideDir,
    })
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('allows directory within workspace', async () => {
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: workspaceDir,
    })
    // Should not be 403 — may be 400 (not a git repo) or 404, but not access denied
    expect(result.status).not.toBe(403)
  })

  test('rejects directory with path traversal', async () => {
    const traversal = resolve(workspaceDir, '..', 'outside')
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: traversal,
    })
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })
})
