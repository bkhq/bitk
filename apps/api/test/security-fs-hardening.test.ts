import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { encodeRoot } from '@/routes/files'
import { get, post } from './helpers'
import app from '@/app'
import './setup'

/**
 * Security hardening tests for file system and git routes.
 * Covers SEC-007, SEC-030.
 * Note: symlink verification (SEC-008, SEC-009) was removed to support
 * worktrees and other legitimate symlink use cases.
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

  // Create symlink inside workspace pointing outside (simulating worktree)
  symlinkSync(outsideDir, resolve(workspaceDir, 'linked-dir'))

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

describe('SEC-007: /api/files/:root/show workspace validation', () => {
  test('allows root within workspace', async () => {
    const encoded = encodeRoot(workspaceDir)
    const result = await get<unknown>(`/api/files/${encoded}/show`)
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
  })

  test('rejects root outside workspace', async () => {
    const encoded = encodeRoot(outsideDir)
    const result = await get<unknown>(`/api/files/${encoded}/show`)
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('rejects root parameter with path traversal', async () => {
    const traversal = resolve(workspaceDir, '..', 'outside')
    const encoded = encodeRoot(traversal)
    const result = await get<unknown>(`/api/files/${encoded}/show`)
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })
})

describe('files/:root/raw serves files correctly', () => {
  test('serves files within workspace normally', async () => {
    const encoded = encodeRoot(workspaceDir)
    const url = `http://localhost/api/files/${encoded}/raw/test.txt`
    const res = await app.request(url)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('hello workspace')
  })

  test('serves nested files', async () => {
    const encoded = encodeRoot(workspaceDir)
    const url = `http://localhost/api/files/${encoded}/raw/subdir/nested.txt`
    const res = await app.request(url)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('nested file')
  })

  test('allows access through symlinks (worktree support)', async () => {
    const encoded = encodeRoot(workspaceDir)
    const url = `http://localhost/api/files/${encoded}/raw/linked-dir/secret.txt`
    const res = await app.request(url)
    // Symlinks are allowed — worktrees and linked dirs are legitimate use cases
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('secret data')
  })
})

describe('files/:root/show browse and file content', () => {
  test('lists directory entries including symlinks', async () => {
    const encoded = encodeRoot(workspaceDir)
    const result = await get<{ path: string, type: string, entries: Array<{ name: string, type: string }> }>(
      `/api/files/${encoded}/show`,
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    const names = result.json.data!.entries.map((e: { name: string }) => e.name)
    expect(names).toContain('test.txt')
    expect(names).toContain('subdir')
    expect(names).toContain('linked-dir')
  })

  test('shows file content', async () => {
    const encoded = encodeRoot(workspaceDir)
    const result = await get<{ path: string, type: string, content: string }>(
      `/api/files/${encoded}/show/test.txt`,
    )
    expect(result.status).toBe(200)
    expect(result.json.data!.type).toBe('file')
    expect(result.json.data!.content).toBe('hello workspace')
  })

  test('rejects path traversal via relative path', async () => {
    const encoded = encodeRoot(workspaceDir)
    const result = await get<unknown>(
      `/api/files/${encoded}/show/..%2F..%2Fetc%2Fpasswd`,
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
