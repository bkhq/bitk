import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveStatic, websocket  } from 'hono/bun'
import app from './app'
import { embeddedStatic } from './embedded-static'
import { issueEngine } from './engines/issue'
import {
  registerSettledReconciliation,
  startPeriodicReconciliation,
  startupReconciliation,
  stopPeriodicReconciliation,
} from './engines/reconciler'
import { startChangesSummaryWatcher } from './events/changes-summary'
import { logger } from './logger'
import { staticAssets } from './static-assets'
import { COMMIT, VERSION } from './version'

// Run startup reconciliation: mark stale sessions as failed and move
// orphaned working issues to review.
void startupReconciliation().catch((err) => {
  logger.error({ err }, 'startup_reconciliation_failed')
})

// Register event-driven reconciliation (fires after each process settles)
registerSettledReconciliation()

// Start periodic reconciliation (fallback safety net)
startPeriodicReconciliation()

// Start watching for file changes to push summaries via SSE
startChangesSummaryWatcher()

const listenHost = process.env.API_HOST ?? '0.0.0.0'
const listenPort = Number(process.env.API_PORT ?? 3000)

// --- Static file serving ---
// In compiled mode, static-assets.ts is replaced at build time with
// generated imports that embed all frontend/dist files.
// In dev mode, the file exports an empty Map and we fall back to disk.
if (staticAssets.size > 0) {
  app.use('*', embeddedStatic(staticAssets))
  logger.info({ assets: staticAssets.size }, 'embedded_static_loaded')
} else {
  const staticRoot = resolve(import.meta.dir, '../frontend/dist')
  if (existsSync(staticRoot)) {
    app.use(
      '/assets/*',
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )

    app.use(
      '*',
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header('Cache-Control', 'public, max-age=3600, must-revalidate')
        },
      }),
    )

    app.get(
      '*',
      serveStatic({
        root: staticRoot,
        path: 'index.html',
        onFound: (_path, c) => {
          c.header('Cache-Control', 'no-cache')
        },
      }),
    )
  }
}

const http = Bun.serve({
  port: listenPort,
  hostname: listenHost,
  idleTimeout: 60,
  fetch: app.fetch,
  websocket,
})

logger.info(
  {
    host: listenHost,
    port: listenPort,
    serverName: 'bitk-api',
    version: VERSION,
    commit: COMMIT,
  },
  'server_started',
)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  logger.warn({ signal }, 'server_shutdown')

  // Stop periodic reconciliation before cancelling processes
  stopPeriodicReconciliation()

  // Cancel all active engine processes before shutting down
  await issueEngine.cancelAll()

  http.stop()
  logger.info('server_stopped')
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
