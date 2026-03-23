// @ts-nocheck -- @modelcontextprotocol/sdk subpath exports may not resolve under Bun monorepo hoisting
import { Hono } from 'hono'
import { getConnInfo } from 'hono/bun'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from '@/mcp/server'
import { getAppSetting } from '@/db/helpers'
import { logger } from '@/logger'

const mcpRoute = new Hono()

// --- Session store with size cap and TTL eviction ---

const MAX_SESSIONS = 100
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

interface McpSession {
  server: ReturnType<typeof createMcpServer>
  transport: WebStandardStreamableHTTPServerTransport
  lastAccess: number
}

const sessions = new Map<string, McpSession>()

function evictStaleSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      sessions.delete(id)
      logger.info({ sessionId: id }, 'mcp_session_evicted_ttl')
    }
  }
}

function getOrCreateSession(sessionId: string | undefined): McpSession {
  if (sessionId) {
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.lastAccess = Date.now()
      return existing
    }
  }

  // Evict stale sessions before creating a new one
  evictStaleSessions()

  // Enforce size cap
  if (sessions.size >= MAX_SESSIONS) {
    // Evict the oldest session
    let oldestId: string | undefined
    let oldestTime = Infinity
    for (const [id, s] of sessions) {
      if (s.lastAccess < oldestTime) {
        oldestTime = s.lastAccess
        oldestId = id
      }
    }
    if (oldestId) {
      sessions.delete(oldestId)
      logger.info({ sessionId: oldestId }, 'mcp_session_evicted_cap')
    }
  }

  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport, lastAccess: Date.now() })
      logger.info({ sessionId: id }, 'mcp_session_created')
    },
    onsessionclosed: (id) => {
      sessions.delete(id)
      logger.info({ sessionId: id }, 'mcp_session_closed')
    },
  })

  void server.connect(transport)
  return { server, transport, lastAccess: Date.now() }
}

// --- Localhost detection via client IP ---

const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

function isLocalhostRequest(c: Parameters<Parameters<typeof mcpRoute.use>[1]>[0]): boolean {
  // Prefer actual client IP from Bun's conninfo (not spoofable)
  try {
    const info = getConnInfo(c)
    const addr = info.remote.address
    if (addr) return LOCALHOST_ADDRS.has(addr)
  } catch {
    // getConnInfo unavailable (e.g., test environment) — fall back to URL hostname
  }
  const hostname = new URL(c.req.url).hostname
  return LOCALHOST_ADDRS.has(hostname)
}

// --- Enabled gate + API key authentication middleware ---

const MCP_ENABLED_SETTING = 'mcp:enabled'
const MCP_API_KEY_SETTING = 'mcp:apiKey'

mcpRoute.use('*', async (c, next) => {
  // Check if MCP is enabled (env override or DB setting)
  const enabledEnv = process.env.MCP_ENABLED
  if (enabledEnv !== undefined) {
    if (enabledEnv !== 'true' && enabledEnv !== '1') {
      return c.json({ error: 'MCP endpoint is disabled' }, 403)
    }
  } else {
    const enabledSetting = await getAppSetting(MCP_ENABLED_SETTING)
    if (enabledSetting !== 'true') {
      return c.json({ error: 'MCP endpoint is disabled. Enable it in Settings.' }, 403)
    }
  }

  // API key authentication
  const apiKey = process.env.MCP_API_KEY ?? (await getAppSetting(MCP_API_KEY_SETTING))

  // If no API key is configured, only allow localhost (using client IP, not Host header)
  if (!apiKey) {
    if (!isLocalhostRequest(c)) {
      return c.json({ error: 'MCP endpoint requires API key or localhost access' }, 403)
    }
    return next()
  }

  const token = c.req.header('authorization')?.replace('Bearer ', '')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  // Use timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token)
  const keyBuf = Buffer.from(apiKey)
  if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

// --- MCP Streamable HTTP endpoint ---

mcpRoute.all('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id')

  // Reuse existing session for any method
  if (sessionId) {
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.lastAccess = Date.now()
      return existing.transport.handleRequest(c.req.raw)
    }
  }

  // POST without a session or with an unknown session — create new
  if (c.req.method === 'POST') {
    const { transport } = getOrCreateSession(undefined)
    return transport.handleRequest(c.req.raw)
  }

  // GET/DELETE without valid session
  return c.json({ error: 'No valid MCP session. Send a POST with an initialize request first.' }, 400)
})

export default mcpRoute
