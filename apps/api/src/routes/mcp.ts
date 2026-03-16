import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from '@/mcp/server'
import { logger } from '@/logger'

const mcpRoute = new Hono()

// Session management for stateful MCP connections
const sessions = new Map<string, { server: ReturnType<typeof createMcpServer>, transport: WebStandardStreamableHTTPServerTransport }>()

function getOrCreateSession(sessionId: string | undefined) {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }

  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport })
      logger.info({ sessionId: id }, 'mcp_session_created')
    },
    onsessionclosed: (id) => {
      sessions.delete(id)
      logger.info({ sessionId: id }, 'mcp_session_closed')
    },
  })

  void server.connect(transport)
  return { server, transport }
}

// MCP Streamable HTTP endpoint — handles POST (messages), GET (SSE), DELETE (teardown)
mcpRoute.all('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id')

  // For GET/DELETE with a session ID, reuse the existing session
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!
    return transport.handleRequest(c.req.raw)
  }

  // For POST without a session or with an unknown session — create new
  if (c.req.method === 'POST') {
    const { transport } = getOrCreateSession(sessionId)
    return transport.handleRequest(c.req.raw)
  }

  // GET/DELETE without valid session
  return c.json({ error: 'No valid MCP session. Send a POST with an initialize request first.' }, 400)
})

export default mcpRoute
