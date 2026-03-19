import { logger } from '@/logger'
import { authConfig } from './config'
import type { OIDCDiscoveryDoc } from './types'

let cachedDiscovery: OIDCDiscoveryDoc | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Fetch OIDC Discovery document from `{issuer}/.well-known/openid-configuration`.
 * Result is cached in memory for 24 hours.
 */
export async function discoverOIDC(): Promise<OIDCDiscoveryDoc> {
  const now = Date.now()
  if (cachedDiscovery && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDiscovery
  }

  const url = `${authConfig.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  logger.info({ url }, 'oidc_discovery_fetch')

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`)
  }

  const doc = (await res.json()) as OIDCDiscoveryDoc

  // Validate required fields
  const required = ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint'] as const
  for (const field of required) {
    if (!doc[field]) {
      throw new Error(`OIDC discovery missing required field: ${field}`)
    }
  }

  cachedDiscovery = doc
  cacheTimestamp = now

  logger.info(
    {
      issuer: doc.issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
    },
    'oidc_discovery_ok',
  )

  return doc
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  code: string,
  codeVerifier: string | undefined,
  redirectUri: string,
): Promise<{ access_token: string, id_token?: string }> {
  const discovery = await discoverOIDC()

  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: authConfig.clientId,
    client_secret: authConfig.clientSecret,
  }

  if (authConfig.pkce && codeVerifier) {
    params.code_verifier = codeVerifier
  }

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }

  return res.json() as Promise<{ access_token: string, id_token?: string }>
}

/**
 * Fetch user info from the OIDC provider.
 */
export async function fetchUserInfo(
  accessToken: string,
): Promise<Record<string, unknown>> {
  const discovery = await discoverOIDC()

  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`Userinfo fetch failed: ${res.status}`)
  }

  return res.json() as Promise<Record<string, unknown>>
}

/**
 * Extract the username value from userinfo based on config.
 * Falls back through: configured field → preferred_username → email → sub.
 */
export function extractUsername(userinfo: Record<string, unknown>): string {
  const field = authConfig.usernameField
  const value = userinfo[field]
  if (typeof value === 'string' && value) return value

  // Fallback chain
  if (field !== 'preferred_username' && typeof userinfo.preferred_username === 'string') {
    return userinfo.preferred_username
  }
  if (field !== 'email' && typeof userinfo.email === 'string') {
    return userinfo.email
  }
  if (typeof userinfo.sub === 'string') {
    return userinfo.sub
  }

  throw new Error('Could not extract username from OIDC userinfo')
}

/**
 * Reset cached discovery (for testing).
 */
export function resetDiscoveryCache(): void {
  cachedDiscovery = null
  cacheTimestamp = 0
}
