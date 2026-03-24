import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { authMiddleware, authRoutes } from './auth'
import { getEngineDiscovery } from './engines/startup-probe'
import { httpLogger, logger } from './logger'
import { apiRoutes, engineRoutes, eventRoutes, settingsRoutes } from './routes'
import cronRoute from './routes/cron'
import mcpRoute from './routes/mcp'
import notesRoutes from './routes/notes'
import terminalRoute from './routes/terminal'
import { VERSION } from './version'

const app = new OpenAPIHono()

// --- Security headers (CSP + HSTS) ---
app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ['\'self\''],
    scriptSrc: ['\'self\'', '\'unsafe-inline\''],
    styleSrc: ['\'self\'', '\'unsafe-inline\''],
    imgSrc: ['\'self\'', 'data:', 'blob:'],
    connectSrc: ['\'self\''],
    fontSrc: ['\'self\''],
    frameAncestors: ['\'none\''],
    baseUri: ['\'self\''],
    formAction: ['\'self\''],
    objectSrc: ['\'none\''],
  },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
}))

// --- CORS ---
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '*'
app.use('/api/*', cors({
  origin: allowedOrigin === '*'
    ? '*'
    : allowedOrigin.split(',').map(o => o.trim()),
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: allowedOrigin !== '*',
}))

// --- Compression (skip for SSE routes) ---
app.use('*', async (c, next) => {
  if (c.req.path.endsWith('/stream') || c.req.path === '/api/events' || c.req.path.startsWith('/api/mcp')) {
    return next()
  }
  return compress()(c, next)
})

// --- HTTP request logging ---
app.use(httpLogger())

// --- Auth routes (public, must be before auth middleware) ---
app.route('/api/auth', authRoutes)

// --- API docs (public, before auth middleware) ---
app.get('/api/docs', swaggerUI({ url: '/api/docs/openapi.json' }))
app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'BKD API',
    description: 'Kanban board for managing AI coding agents. Issues are assigned to CLI-based AI engines (Claude Code, Codex, Gemini CLI) that execute autonomously.',
    version: VERSION,
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Default' }],
  tags: [
    { name: 'Meta', description: 'Health, status, and runtime information' },
    { name: 'Projects', description: 'Project CRUD and lifecycle' },
    { name: 'Issues', description: 'Issue CRUD, bulk updates, and duplication' },
    { name: 'Issue Commands', description: 'Execute, follow-up, restart, cancel AI sessions' },
    { name: 'Issue Logs', description: 'Retrieve and filter issue conversation logs' },
    { name: 'Engines', description: 'AI engine discovery, settings, and models' },
    { name: 'Cron', description: 'Scheduled job management' },
    { name: 'Events', description: 'Server-Sent Events for real-time updates' },
    { name: 'Processes', description: 'Active engine process management' },
    { name: 'Worktrees', description: 'Git worktree management per project' },
    { name: 'Notes', description: 'Scratch notes' },
    { name: 'Settings', description: 'Application settings and configuration' },
    { name: 'Webhooks', description: 'Webhook notification management' },
  ],
})
app.get('/api/openapi.json', c => c.redirect('/api/docs/openapi.json'))

// --- Auth middleware (protects all routes below when AUTH_ENABLED=true) ---
app.use('/api/*', authMiddleware())

// --- Routes ---
app.route('/api', apiRoutes)
app.route('/api/engines', engineRoutes)
app.route('/api/events', eventRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/notes', notesRoutes)
app.route('/api/cron', cronRoute)
app.route('/api/mcp', mcpRoute)
app.route('/api', terminalRoute)

// --- 404 handler ---
app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'Not Found' }, 404)
})

// --- API-002: Global error handler ---
app.onError((err, c) => {
  // Log the error
  logger.error(
    {
      message: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
    },
    'unhandled_error',
  )

  // JSON request-body parse errors — only match errors from body parsing,
  // not from application-level JSON.parse() of stored metadata etc.
  // Bun/Hono body parsing produces messages like "JSON Parse error: ..."
  // or "Unexpected token ... in JSON at position ...".
  if (err instanceof SyntaxError) {
    const msg = err.message
    const isBodyParse =
      msg.startsWith('JSON Parse error') || /^Unexpected (token|end of JSON)/.test(msg)
    if (isBodyParse) {
      return c.json({ success: false, error: 'Invalid JSON' }, 400)
    }
  }

  // All other errors
  return c.json({ success: false, error: 'Internal server error' }, 500)
})

// Warm up engine discovery on startup (cache → DB → live probe)
void getEngineDiscovery().catch((err) => {
  logger.error(
    {
      error: err instanceof Error ? err.message : String(err),
    },
    'probe_failed',
  )
})

export default app
