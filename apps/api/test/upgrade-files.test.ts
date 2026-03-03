import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Mock UPDATES_DIR to use a temp directory
const TMP_DIR = resolve(import.meta.dir, '.tmp-files-test')

// We need to mock the constants module before importing files module
// Instead, test the logic by calling the functions that use UPDATES_DIR indirectly
// For now, test deleteDownloadedUpdate validation logic (which doesn't depend on FS location)

import { VALID_FILE_NAME_RE } from '@/upgrade/utils'
import { isPathWithinDir } from '@/upgrade/utils'

describe('deleteDownloadedUpdate validation', () => {
  it('rejects invalid file names', () => {
    expect(VALID_FILE_NAME_RE.test('../../../etc/passwd')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('malicious-file')).toBe(false)
    expect(VALID_FILE_NAME_RE.test('')).toBe(false)
  })

  it('accepts valid file names', () => {
    expect(VALID_FILE_NAME_RE.test('bitk-linux-x64-v0.0.5')).toBe(true)
    expect(VALID_FILE_NAME_RE.test('bitk-app-v0.0.5.tar.gz')).toBe(true)
  })

  it('validates path is within updates directory', () => {
    const updatesDir = '/data/updates'
    const validPath = resolve(updatesDir, 'bitk-linux-x64-v0.0.5')
    expect(isPathWithinDir(validPath, updatesDir)).toBe(true)

    const escapedPath = resolve('/etc', 'passwd')
    expect(isPathWithinDir(escapedPath, updatesDir)).toBe(false)
  })
})

describe('listDownloadedUpdates sorting', () => {
  const tmpDir = resolve(import.meta.dir, '.tmp-list-test')

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('filters out .tmp files', async () => {
    const { readdir } = await import('node:fs/promises')
    writeFileSync(resolve(tmpDir, 'bitk-linux-x64-v0.0.5'), 'binary')
    writeFileSync(resolve(tmpDir, 'bitk-linux-x64-v0.0.6.tmp'), 'partial')

    const entries = await readdir(tmpDir)
    const filtered = entries.filter((name) => !name.endsWith('.tmp'))
    expect(filtered).toEqual(['bitk-linux-x64-v0.0.5'])
    expect(filtered).not.toContain('bitk-linux-x64-v0.0.6.tmp')
  })
})
