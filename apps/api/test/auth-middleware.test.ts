import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { authConfig } from '@/auth/config'
import { signToken } from '@/auth/jwt'
import { authMiddleware } from '@/auth/middleware'
import type { AuthUser } from '@/auth/types'

// Force a known secret
;(authConfig as any).secret = 'test-secret-key-for-middleware-tests'
;(authConfig as any).sessionTtl = 3600

const testUser: AuthUser = {
  sub: 'user-456',
  username: 'bob',
  email: 'bob@example.com',
}

function createApp() {
  const app = new Hono()
  app.use('/api/*', authMiddleware())
  app.get('/api/test', (c) => {
    const user = c.get('user')
    return c.json({ success: true, data: { user } })
  })
  app.get('/api/auth/config', (c) => {
    return c.json({ success: true, data: { enabled: authConfig.enabled } })
  })
  return app
}

afterEach(() => {
  ;(authConfig as any).enabled = false
})

describe('auth middleware', () => {
  test('passes through when auth is disabled', async () => {
    ;(authConfig as any).enabled = false
    const app = createApp()
    const res = await app.request('/api/test')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  test('returns 401 without token when auth is enabled', async () => {
    ;(authConfig as any).enabled = true
    const app = createApp()
    const res = await app.request('/api/test')
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('Unauthorized')
  })

  test('returns 401 with invalid token', async () => {
    ;(authConfig as any).enabled = true
    const app = createApp()
    const res = await app.request('/api/test', {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Invalid or expired token')
  })

  test('passes with valid Bearer token', async () => {
    ;(authConfig as any).enabled = true
    const app = createApp()
    const token = signToken(testUser)
    const res = await app.request('/api/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.user.username).toBe('bob')
  })

  test('accepts token from query parameter', async () => {
    ;(authConfig as any).enabled = true
    const app = createApp()
    const token = signToken(testUser)
    const res = await app.request(`/api/test?token=${token}`)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.user.username).toBe('bob')
  })

  test('skips auth for /api/auth/* routes', async () => {
    ;(authConfig as any).enabled = true
    const app = createApp()
    const res = await app.request('/api/auth/config')
    expect(res.status).toBe(200)
  })
})
