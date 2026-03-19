import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import { logger } from '@/logger'
import { authConfig } from './config'
import { signToken, verifyToken } from './jwt'
import { discoverOIDC, exchangeCode, extractUsername, fetchUserInfo } from './oidc'
import type { AuthUser } from './types'

const auth = new Hono()

/**
 * GET /api/auth/config
 * Public endpoint. Returns auth configuration for the frontend.
 * Never exposes secrets.
 */
auth.get('/config', async (c) => {
  if (!authConfig.enabled) {
    return c.json({
      success: true,
      data: { enabled: false },
    })
  }

  try {
    const discovery = await discoverOIDC()
    return c.json({
      success: true,
      data: {
        enabled: true,
        clientId: authConfig.clientId,
        authorizeUrl: discovery.authorization_endpoint,
        scopes: authConfig.scopes,
        pkce: authConfig.pkce,
      },
    })
  } catch (err) {
    logger.error({ err }, 'auth_config_discovery_failed')
    return c.json({
      success: true,
      data: {
        enabled: true,
        clientId: authConfig.clientId,
        authorizeUrl: null,
        scopes: authConfig.scopes,
        pkce: authConfig.pkce,
        error: 'OIDC discovery failed',
      },
    })
  }
})

/**
 * POST /api/auth/token
 * Exchange authorization code for a BKD session token.
 * Body: { code, codeVerifier?, redirectUri }
 */
auth.post(
  '/token',
  zValidator(
    'json',
    z.object({
      code: z.string().min(1),
      codeVerifier: z.string().optional(),
      redirectUri: z.string().url(),
    }),
  ),
  async (c) => {
    if (!authConfig.enabled) {
      return c.json({ success: false, error: 'Auth is not enabled' }, 400)
    }

    const { code, codeVerifier, redirectUri } = c.req.valid('json')

    try {
      // 1. Exchange code for tokens with OIDC provider
      const tokens = await exchangeCode(code, codeVerifier, redirectUri)

      // 2. Fetch user info
      const userinfo = await fetchUserInfo(tokens.access_token)

      // 3. Extract username and check whitelist
      const username = extractUsername(userinfo)
      const email = (typeof userinfo.email === 'string' ? userinfo.email : '') || ''
      const sub = (typeof userinfo.sub === 'string' ? userinfo.sub : username)

      const usernameLC = username.toLowerCase()
      const emailLC = email.toLowerCase()

      const isAllowed = authConfig.allowedUsers.some(
        allowed => allowed === usernameLC || allowed === emailLC,
      )

      if (!isAllowed) {
        logger.warn({ username, email }, 'auth_user_not_in_whitelist')
        return c.json(
          { success: false, error: 'User not authorized' },
          403,
        )
      }

      // 4. Sign BKD session JWT
      const user: AuthUser = { sub, username, email }
      const token = signToken(user)

      logger.info({ username, email }, 'auth_login_success')

      return c.json({
        success: true,
        data: { token, user: { username, email } },
      })
    } catch (err) {
      logger.error({ err }, 'auth_token_exchange_failed')
      return c.json(
        { success: false, error: 'Authentication failed' },
        401,
      )
    }
  },
)

/**
 * GET /api/auth/me
 * Validate Bearer token and return user info.
 */
auth.get('/me', (c) => {
  if (!authConfig.enabled) {
    return c.json({ success: false, error: 'Auth is not enabled' }, 400)
  }

  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }

  const user = verifyToken(token)
  if (!user) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401)
  }

  return c.json({
    success: true,
    data: { username: user.username, email: user.email },
  })
})

/**
 * POST /api/auth/logout
 * No-op server-side (stateless JWT). Frontend clears localStorage.
 */
auth.post('/logout', (c) => {
  return c.json({ success: true })
})

export default auth
