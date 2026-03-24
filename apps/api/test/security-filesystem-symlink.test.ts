/**
 * Security tests for filesystem symlink escape prevention.
 * Verifies that symlinks inside the workspace pointing outside are rejected.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { expectSuccess, get, post } from './helpers'
import './setup'

const tmpBase = resolve('/tmp', `bkd-symlink-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')
const outsideDir = resolve(tmpBase, 'outside')
const outsideSecretDir = resolve(outsideDir, 'secrets')
const symlinkInWorkspace = resolve(workspaceDir, 'escape-link')
const normalSubdir = resolve(workspaceDir, 'normal-subdir')

beforeAll(async () => {
  // Create directory structure:
  //   /tmp/bkd-symlink-test-PID/
  //     workspace/
  //       normal-subdir/
  //       escape-link -> ../outside/secrets
  //     outside/
  //       secrets/
  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(normalSubdir, { recursive: true })
  mkdirSync(outsideSecretDir, { recursive: true })
  symlinkSync(outsideSecretDir, symlinkInWorkspace)

  // Set workspace root to our test workspace
  await setAppSetting('workspace:defaultPath', workspaceDir)
})

afterAll(async () => {
  // Restore workspace root
  await setAppSetting('workspace:defaultPath', '')

  // Cleanup
  try {
    rmSync(tmpBase, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('GET /api/filesystem/dirs — symlink escape', () => {
  test('rejects symlink that points outside workspace', async () => {
    const result = await get<unknown>(
      `/api/filesystem/dirs?path=${encodeURIComponent(symlinkInWorkspace)}`,
    )
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('allows normal subdirectory inside workspace', async () => {
    const result = await get<{
      current: string
      parent: string | null
      dirs: string[]
    }>(`/api/filesystem/dirs?path=${encodeURIComponent(normalSubdir)}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.current).toBe(normalSubdir)
  })

  test('allows workspace root itself', async () => {
    const result = await get<{
      current: string
      parent: string | null
      dirs: string[]
    }>(`/api/filesystem/dirs?path=${encodeURIComponent(workspaceDir)}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.current).toBe(workspaceDir)
  })

  test('rejects direct outside path (baseline)', async () => {
    const result = await get<unknown>(
      `/api/filesystem/dirs?path=${encodeURIComponent(outsideDir)}`,
    )
    expect(result.status).toBe(403)
  })
})

describe('POST /api/filesystem/dirs — symlink escape', () => {
  test('rejects creating directory under symlink that escapes workspace', async () => {
    const result = await post<unknown>('/api/filesystem/dirs', {
      path: symlinkInWorkspace,
      name: 'should-not-create',
    })
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('allows creating directory under normal workspace path', async () => {
    const dirName = `safe-dir-${Date.now()}`
    const result = await post<{ path: string }>('/api/filesystem/dirs', {
      path: normalSubdir,
      name: dirName,
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.path).toBe(resolve(normalSubdir, dirName))
  })
})
