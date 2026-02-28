import process from 'node:process'

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
  // Engine-specific auth
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
 */
export function safeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) {
      env[key] = process.env[key]!
    }
  }
  if (extra) {
    Object.assign(env, extra)
  }
  return env
}
