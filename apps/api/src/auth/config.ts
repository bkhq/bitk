import { randomBytes } from 'node:crypto'
import type { AuthConfig } from './types'

/**
 * Auto-detect which OIDC userinfo field to match against the whitelist,
 * based on the issuer domain.
 */
function detectUsernameField(issuer: string): string {
  try {
    const host = new URL(issuer).hostname
    if (host === 'github.com' || host.endsWith('.github.com')) return 'login'
    if (host === 'accounts.google.com') return 'email'
    if (host.includes('gitlab')) return 'username'
  } catch {
    // invalid URL — fall through
  }
  return 'preferred_username'
}

function parseAuthConfig(): AuthConfig {
  const enabled = process.env.AUTH_ENABLED === 'true'

  if (!enabled) {
    return {
      enabled: false,
      issuer: '',
      clientId: '',
      clientSecret: '',
      allowedUsers: [],
      secret: '',
      pkce: true,
      scopes: 'openid profile email',
      usernameField: 'preferred_username',
      sessionTtl: 604800,
    }
  }

  const issuer = process.env.AUTH_ISSUER
  const clientId = process.env.AUTH_CLIENT_ID
  const clientSecret = process.env.AUTH_CLIENT_SECRET
  const allowedUsersRaw = process.env.AUTH_ALLOWED_USERS

  const missing: string[] = []
  if (!issuer) missing.push('AUTH_ISSUER')
  if (!clientId) missing.push('AUTH_CLIENT_ID')
  if (!clientSecret) missing.push('AUTH_CLIENT_SECRET')
  if (!allowedUsersRaw) missing.push('AUTH_ALLOWED_USERS')

  if (missing.length > 0) {
    throw new Error(
      `AUTH_ENABLED=true but missing required env vars: ${missing.join(', ')}`,
    )
  }

  const allowedUsers = allowedUsersRaw!
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean)

  if (allowedUsers.length === 0) {
    throw new Error('AUTH_ALLOWED_USERS must contain at least one username')
  }

  const secret = process.env.AUTH_SECRET || randomBytes(32).toString('hex')
  const pkce = process.env.AUTH_PKCE !== 'false'
  const scopes = process.env.AUTH_SCOPES || 'openid profile email'
  const usernameField = process.env.AUTH_USERNAME_FIELD || detectUsernameField(issuer!)
  const sessionTtl = Number(process.env.AUTH_SESSION_TTL) || 604800

  return {
    enabled,
    issuer: issuer!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    allowedUsers,
    secret,
    pkce,
    scopes,
    usernameField,
    sessionTtl,
  }
}

export const authConfig = parseAuthConfig()
