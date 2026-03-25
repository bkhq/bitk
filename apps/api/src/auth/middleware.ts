import type { MiddlewareHandler } from 'hono'
import { authConfig } from './config'
import { verifyToken } from './jwt'
import type { AuthUser } from './types'

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser | undefined
  }
}

/**
 * Auth middleware for Hono.
 *
 * When `AUTH_ENABLED=true`:
 * - Skips auth for `/api/auth/*` routes (login flow needs to be public)
 * - Extracts Bearer token from `Authorization` header
 * - Falls back to `token` query parameter (for SSE/EventSource which can't set headers)
 * - Verifies server-signed JWT
 * - Sets `c.var.user` on success
 * - Returns 401 on failure
 *
 * When `AUTH_ENABLED=false`:
 * - All requests pass through with no user context
 */
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Auth disabled → pass through
    if (!authConfig.enabled) {
      return next()
    }

    // Skip auth routes themselves (they're public by definition)
    if (c.req.path.startsWith('/api/auth/')) {
      return next()
    }

    // Skip MCP — it handles its own auth (localhost bypass for engines)
    if (c.req.path.startsWith('/api/mcp')) {
      return next()
    }

    // Extract Bearer token from Authorization header
    const authHeader = c.req.header('Authorization')
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    // Fallback: token query parameter (for EventSource / WebSocket)
    if (!token) {
      const url = new URL(c.req.url)
      token = url.searchParams.get('token')
    }

    if (!token) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    // Verify server-signed JWT
    const user = verifyToken(token)
    if (!user) {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401)
    }

    // Set user in context for downstream handlers
    c.set('user', user)
    return next()
  }
}
