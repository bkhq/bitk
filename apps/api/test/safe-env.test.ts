import process from 'node:process'
import { beforeAll, describe, expect, test } from 'bun:test'
import { safeEnv } from '@/engines/safe-env'

// Ensure test API keys are set so we can verify filtering
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.GOOGLE_API_KEY = 'test-google-key'
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.CODEX_API_KEY = 'test-codex-key'
})

describe('safeEnv', () => {
  describe('protected key filtering', () => {
    test('blocks user-supplied PATH override', () => {
      const env = safeEnv({ PATH: '/malicious/bin' })
      expect(env.PATH).toBe(process.env.PATH)
      expect(env.PATH).not.toBe('/malicious/bin')
    })

    test('blocks user-supplied HOME override', () => {
      const env = safeEnv({ HOME: '/tmp/evil' })
      expect(env.HOME).toBe(process.env.HOME)
    })

    test('blocks user-supplied ANTHROPIC_API_KEY override', () => {
      const env = safeEnv({ ANTHROPIC_API_KEY: 'stolen-key' })
      expect(env.ANTHROPIC_API_KEY).toBe('test-anthropic-key')
    })

    test('blocks user-supplied OPENAI_API_KEY override', () => {
      const env = safeEnv({ OPENAI_API_KEY: 'stolen-key' })
      expect(env.OPENAI_API_KEY).toBe('test-openai-key')
    })

    test('blocks user-supplied IS_SANDBOX override', () => {
      process.env.IS_SANDBOX = '1'
      const env = safeEnv({ IS_SANDBOX: '0' })
      expect(env.IS_SANDBOX).toBe('1')
      delete process.env.IS_SANDBOX
    })

    test('allows non-protected user env vars', () => {
      const env = safeEnv({ MY_CUSTOM_VAR: 'hello', ANOTHER_VAR: 'world' })
      expect(env.MY_CUSTOM_VAR).toBe('hello')
      expect(env.ANOTHER_VAR).toBe('world')
    })

    test('blocks multiple protected keys at once', () => {
      const env = safeEnv({
        PATH: '/evil',
        HOME: '/evil',
        ANTHROPIC_API_KEY: 'evil',
        SAFE_VAR: 'allowed',
      })
      expect(env.PATH).toBe(process.env.PATH)
      expect(env.HOME).toBe(process.env.HOME)
      expect(env.ANTHROPIC_API_KEY).toBe('test-anthropic-key')
      expect(env.SAFE_VAR).toBe('allowed')
    })
  })

  describe('engine-specific API key filtering', () => {
    test('claude-code only gets ANTHROPIC_API_KEY', () => {
      const env = safeEnv(undefined, 'claude-code')
      expect(env.ANTHROPIC_API_KEY).toBe('test-anthropic-key')
      expect(env.OPENAI_API_KEY).toBeUndefined()
      expect(env.GOOGLE_API_KEY).toBeUndefined()
      expect(env.GEMINI_API_KEY).toBeUndefined()
      expect(env.CODEX_API_KEY).toBeUndefined()
    })

    test('codex gets OPENAI_API_KEY and CODEX_API_KEY', () => {
      const env = safeEnv(undefined, 'codex')
      expect(env.OPENAI_API_KEY).toBe('test-openai-key')
      expect(env.CODEX_API_KEY).toBe('test-codex-key')
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.GOOGLE_API_KEY).toBeUndefined()
      expect(env.GEMINI_API_KEY).toBeUndefined()
    })

    test('acp gets all API keys', () => {
      const env = safeEnv(undefined, 'acp')
      expect(env.ANTHROPIC_API_KEY).toBe('test-anthropic-key')
      expect(env.OPENAI_API_KEY).toBe('test-openai-key')
      expect(env.GOOGLE_API_KEY).toBe('test-google-key')
      expect(env.GEMINI_API_KEY).toBe('test-gemini-key')
      expect(env.CODEX_API_KEY).toBe('test-codex-key')
    })

    test('echo gets no API keys', () => {
      const env = safeEnv(undefined, 'echo')
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.OPENAI_API_KEY).toBeUndefined()
      expect(env.GOOGLE_API_KEY).toBeUndefined()
      expect(env.GEMINI_API_KEY).toBeUndefined()
      expect(env.CODEX_API_KEY).toBeUndefined()
    })

    test('no engineType passes all API keys (backward compat)', () => {
      const env = safeEnv()
      expect(env.ANTHROPIC_API_KEY).toBe('test-anthropic-key')
      expect(env.OPENAI_API_KEY).toBe('test-openai-key')
      expect(env.GOOGLE_API_KEY).toBe('test-google-key')
      expect(env.GEMINI_API_KEY).toBe('test-gemini-key')
      expect(env.CODEX_API_KEY).toBe('test-codex-key')
    })
  })

  describe('basic allowlisting', () => {
    test('includes PATH and HOME from process.env', () => {
      const env = safeEnv()
      expect(env.PATH).toBe(process.env.PATH)
      expect(env.HOME).toBe(process.env.HOME)
    })

    test('excludes non-allowlisted process.env vars', () => {
      process.env.SECRET_DB_PASSWORD = 'super-secret'
      const env = safeEnv()
      expect(env.SECRET_DB_PASSWORD).toBeUndefined()
      delete process.env.SECRET_DB_PASSWORD
    })
  })
})
