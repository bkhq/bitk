import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeFileSha256 } from '@/upgrade/checksum'

const TMP_DIR = resolve(import.meta.dir, '.tmp-checksum-test')

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('computeFileSha256', () => {
  it('computes correct sha256 for a known string', async () => {
    const filePath = resolve(TMP_DIR, 'hello.txt')
    await Bun.write(filePath, 'hello world\n')
    const hash = await computeFileSha256(filePath)
    // sha256("hello world\n") = a948904f2f0f479b8f8564e9d1d33c4d...
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(
      'a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447',
    )
  })

  it('computes correct sha256 for empty file', async () => {
    const filePath = resolve(TMP_DIR, 'empty.txt')
    await Bun.write(filePath, '')
    const hash = await computeFileSha256(filePath)
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('produces different hashes for different content', async () => {
    const path1 = resolve(TMP_DIR, 'a.txt')
    const path2 = resolve(TMP_DIR, 'b.txt')
    await Bun.write(path1, 'content A')
    await Bun.write(path2, 'content B')
    const hash1 = await computeFileSha256(path1)
    const hash2 = await computeFileSha256(path2)
    expect(hash1).not.toBe(hash2)
  })
})
