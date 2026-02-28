import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { secureHeaders } from 'hono/secure-headers'
import { getEngineDiscovery } from './engines/startup-probe'
import { httpLogger, logger } from './logger'
import { apiRoutes, engineRoutes, eventRoutes, settingsRoutes } from './routes'
import terminalRoute from './routes/terminal'

const app = new Hono()

// --- Security headers ---
app.use(secureHeaders())

// --- Compression (skip for SSE routes) ---
app.use('*', async (c, next) => {
  if (c.req.path.endsWith('/stream') || c.req.path === '/api/events') {
    return next()
  }
  return compress()(c, next)
})

// --- HTTP request logging ---
app.use(httpLogger())

// --- Routes ---
app.route('/api', apiRoutes)
app.route('/api/engines', engineRoutes)
app.route('/api/events', eventRoutes)
app.route('/api/settings', settingsRoutes)
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

  // JSON parse errors
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
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
