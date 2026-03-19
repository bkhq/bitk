const TOKEN_KEY = 'bkd_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // localStorage unavailable
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage unavailable
  }
}

/**
 * Generate PKCE code verifier (random 128 chars from unreserved charset).
 */
export function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const array = new Uint8Array(128)
  crypto.getRandomValues(array)
  return Array.from(array, b => chars[b % chars.length]).join('')
}

/**
 * Generate PKCE code challenge from verifier (SHA-256 + base64url).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export interface AuthConfigResponse {
  enabled: boolean
  clientId?: string
  authorizeUrl?: string | null
  scopes?: string
  pkce?: boolean
  error?: string
}

/**
 * Fetch auth config from the server (public endpoint).
 */
export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const res = await fetch('/api/auth/config')
  const json = await res.json()
  if (!json.success) throw new Error(json.error)
  return json.data as AuthConfigResponse
}
