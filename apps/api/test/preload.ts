/**
 * Test preload — runs before any test file is loaded.
 * Sets up the test database path so all app modules use a test DB.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { ROOT_DIR } from '@/root'

const testDir = resolve(ROOT_DIR, 'data/test')
const testDbPath = resolve(testDir, `test-${process.pid}-${Date.now()}.db`)

// Set DB_PATH before any app module is imported
process.env.DB_PATH = testDbPath
// Ensure no auth is needed
process.env.API_SECRET = ''
// Suppress engine startup probe logs during tests
process.env.NODE_ENV = 'test'

// Create test directory
if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true })
}
// Store path for cleanup
;(globalThis as any).__TEST_DB_PATH = testDbPath

// Override codex executor with mock for tests (no real subprocess)
// eslint-disable-next-line antfu/no-top-level-await
const { engineRegistry } = await import('@/engines/executors')
// eslint-disable-next-line antfu/no-top-level-await
const { MockCodexExecutor } = await import('./mock-codex-executor')
;(engineRegistry as any).register(new MockCodexExecutor())
