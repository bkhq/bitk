import process from 'node:process'
import { logger } from '@/logger'

import type { EngineType } from './types'

/**
 * Keys that user-provided envVars (from project settings) must never override.
 * These control security-critical paths and authentication credentials.
 */
const PROTECTED_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'IS_SANDBOX',
  'NODE_ENV',
  'BUN_ENV',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
])

/**
 * Map engine types to the API key(s) they actually need.
 * Keys not in the engine's set are excluded from the environment.
 */
const ENGINE_API_KEYS: Record<string, string[]> = {
  'claude-code': ['ANTHROPIC_API_KEY'],
  'codex': ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  'acp': ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY'],
}

const ALL_API_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
])

/**
 * Allowlist of environment variables safe to pass to child engine processes.
 * Prevents leaking secrets like DB_PATH, API_SECRET, or other sensitive vars.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'TERM',
  'NPM_CONFIG_LOGLEVEL',
  // Engine-specific auth — filtered per engine by safeEnv()
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  // Sandbox flag (allows --dangerously-skip-permissions as root)
  'IS_SANDBOX',
  // Commonly needed
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
]

/**
 * Build an env object containing only allowlisted vars from process.env,
 * merged with any extra vars from the caller.
 *
 * Protected keys (PATH, HOME, API keys, etc.) cannot be overridden by
 * user-supplied `extra` vars. When an `engineType` is provided, only the
 * relevant API key(s) for that engine are included.
 */
export function safeEnv(extra?: Record<string, string>, engineType?: EngineType): Record<string, string> {
  // Determine which API keys to include based on engine type
  const allowedApiKeys = engineType
    ? new Set(ENGINE_API_KEYS[engineType] ?? [])
    : ALL_API_KEYS // no engine specified → include all (backward compat for probes etc.)

  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    // Skip API keys not relevant to this engine
    if (ALL_API_KEYS.has(key) && !allowedApiKeys.has(key)) {
      continue
    }
    if (process.env[key]) {
      env[key] = process.env[key]!
    }
  }

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (PROTECTED_KEYS.has(key)) {
        logger.warn({ key }, 'env_override_blocked: user-supplied envVar tried to override a protected key')
        continue
      }
      env[key] = value
    }
  }

  return env
}
