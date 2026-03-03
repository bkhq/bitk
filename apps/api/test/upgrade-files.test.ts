import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPathWithinDir, VALID_FILE_NAME_RE } from '@/upgrade/utils'

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
