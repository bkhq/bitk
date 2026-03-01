import { Hono } from 'hono'
import { checkDbHealth } from '@/db'
import { COMMIT, VERSION } from '@/version'
import filesystem from './filesystem'
import issues from './issues'
import projects from './projects'

const apiRoutes = new Hono()

// DB-backed routes
apiRoutes.route('/projects', projects)
apiRoutes.route('/projects/:projectId/issues', issues)

// Infrastructure routes
apiRoutes.route('/filesystem', filesystem)

function detectRuntime() {
  const hasBunGlobal = typeof Bun !== 'undefined'
  const bunVersion = process.versions?.bun ?? null
  const nodeRelease = process.release?.name ?? null
  const nodeVersion = process.versions?.node ?? null
  const execPath = process.execPath ?? null

  if (hasBunGlobal || bunVersion) {
    return {
      runtime: 'bun' as const,
      confidence: 'high' as const,
      signals: {
        hasBunGlobal,
        bunVersion,
        nodeRelease,
        nodeVersion,
        execPath,
      },
    }
  }

  if (nodeRelease === 'node' || nodeVersion) {
    return {
      runtime: 'node' as const,
      confidence: 'high' as const,
      signals: {
        hasBunGlobal,
        bunVersion,
        nodeRelease,
        nodeVersion,
        execPath,
      },
    }
  }

  return {
    runtime: 'unknown' as const,
    confidence: 'low' as const,
    signals: {
      hasBunGlobal,
      bunVersion,
      nodeRelease,
      nodeVersion,
      execPath,
    },
  }
}

function getRuntimeInfo() {
  const detected = detectRuntime()

  return {
    version: VERSION,
    commit: COMMIT,
    runtime: detected.runtime,
    confidence: detected.confidence,
    isBun: detected.runtime === 'bun',
    isNode: detected.runtime === 'node',
    signals: detected.signals,
    versions: {
      bun: process.versions?.bun ?? null,
      node: process.versions?.node ?? null,
      v8: process.versions?.v8 ?? null,
      uv: process.versions?.uv ?? null,
    },
    process: {
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      cwd: process.cwd(),
      uptimeSeconds: process.uptime(),
      platform: process.platform,
      arch: process.arch,
      env: {
        API_HOST: process.env.API_HOST ?? null,
        API_PORT: process.env.API_PORT ?? null,
      },
    },
    timestamp: new Date().toISOString(),
  }
}

apiRoutes.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      name: 'bitk-api',
      status: 'ok',
      routes: ['GET /api', 'GET /api/health', 'GET /api/runtime'],
    },
  })
})

apiRoutes.get('/health', async (c) => {
  const dbHealth = await checkDbHealth()
  return c.json({
    success: true,
    data: {
      status: 'ok',
      version: VERSION,
      commit: COMMIT,
      db: dbHealth.ok ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    },
  })
})

apiRoutes.get('/status', async (c) => {
  const dbHealth = await checkDbHealth()
  const memUsage = process.memoryUsage()
  return c.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      db: dbHealth,
    },
  })
})

// SEC-017: Gate /api/runtime behind explicit opt-in env var
apiRoutes.get('/runtime', (c) => {
  if (process.env.ENABLE_RUNTIME_ENDPOINT !== 'true') {
    return c.json({ success: false, error: 'Not Found' }, 404)
  }

  // Strip sensitive process info (argv, execPath)
  const info = getRuntimeInfo()
  // Remove execPath from signals to avoid leaking binary path
  if (info.signals) {
    const { execPath: _, ...rest } = info.signals as Record<string, unknown>
    info.signals = rest
  }
  return c.json(info)
})

export default apiRoutes
