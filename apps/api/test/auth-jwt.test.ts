import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { signToken, verifyToken } from '@/auth/jwt'
import { authConfig } from '@/auth/config'
import type { AuthUser } from '@/auth/types'

// Force a known secret for deterministic tests
;(authConfig as any).secret = 'test-secret-key-for-jwt-tests-1234567890'
;(authConfig as any).sessionTtl = 3600 // 1 hour

const testUser: AuthUser = {
  sub: 'user-123',
  username: 'alice',
  email: 'alice@example.com',
}

describe('JWT sign/verify', () => {
  test('signs and verifies a valid token', () => {
    const token = signToken(testUser)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)

    const user = verifyToken(token)
    expect(user).not.toBeNull()
    expect(user!.sub).toBe('user-123')
    expect(user!.username).toBe('alice')
    expect(user!.email).toBe('alice@example.com')
  })

  test('rejects a tampered token', () => {
    const token = signToken(testUser)
    const tampered = `${token}x`
    expect(verifyToken(tampered)).toBeNull()
  })

  test('rejects a token with modified payload', () => {
    const token = signToken(testUser)
    const parts = token.split('.')
    // Tamper with payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    payload.username = 'evil'
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')
    expect(verifyToken(parts.join('.'))).toBeNull()
  })

  test('rejects an expired token', () => {
    // Temporarily set TTL to -1 second
    const originalTtl = authConfig.sessionTtl
    ;(authConfig as any).sessionTtl = -1

    const token = signToken(testUser)
    expect(verifyToken(token)).toBeNull()

    ;(authConfig as any).sessionTtl = originalTtl
  })

  test('rejects malformed input', () => {
    expect(verifyToken('')).toBeNull()
    expect(verifyToken('not.a.jwt.token')).toBeNull()
    expect(verifyToken('abc')).toBeNull()
    expect(verifyToken('a.b')).toBeNull()
  })
})
