import { createHmac } from 'node:crypto'
import { authConfig } from './config'
import type { AuthUser, TokenPayload } from './types'

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString('base64url')
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function hmacSign(input: string): string {
  return createHmac('sha256', authConfig.secret)
    .update(input)
    .digest('base64url')
}

export function signToken(user: AuthUser): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64urlEncode(
    JSON.stringify({
      sub: user.sub,
      username: user.username,
      email: user.email,
      iat: now,
      exp: now + authConfig.sessionTtl,
    } satisfies TokenPayload),
  )

  const signature = hmacSign(`${header}.${payload}`)
  return `${header}.${payload}.${signature}`
}

export function verifyToken(token: string): AuthUser | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts

  // Verify signature
  const expected = hmacSign(`${header}.${payload}`)
  if (signature !== expected) return null

  try {
    const data = JSON.parse(base64urlDecode(payload)) as TokenPayload

    // Check expiry
    const now = Math.floor(Date.now() / 1000)
    if (data.exp <= now) return null

    return {
      sub: data.sub,
      username: data.username,
      email: data.email,
    }
  } catch {
    return null
  }
}
