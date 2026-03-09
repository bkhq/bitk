/**
 * Test setup — import in every test file for cleanup registration.
 * DB_PATH is already set by preload.ts.
 */

import { afterAll } from 'bun:test'
import { rmSync } from 'node:fs'

const testDbPath = (globalThis as any).__TEST_DB_PATH as string

afterAll(() => {
  if (!testDbPath) return
  try {
    rmSync(testDbPath, { force: true })
    rmSync(`${testDbPath}-wal`, { force: true })
    rmSync(`${testDbPath}-shm`, { force: true })
  } catch {
    // ignore cleanup errors
  }
})
