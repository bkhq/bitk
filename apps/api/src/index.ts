import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveStatic, websocket } from 'hono/bun'
import app from './app'
import { embeddedStatic } from './embedded-static'
import { issueEngine } from './engines/issue'
import {
  migrateSlashCommandsKey,
  refreshSlashCommandsCache,
} from './engines/issue/queries'
import {
  registerSettledReconciliation,
  startPeriodicReconciliation,
  startupReconciliation,
  stopPeriodicReconciliation,
} from './engines/reconciler'
import {
  startChangesSummaryWatcher,
  stopChangesSummaryWatcher,
} from './events/changes-summary'
import { startUploadCleanup } from './jobs/upload-cleanup'
import { startWorktreeCleanup } from './jobs/worktree-cleanup'
import { logger } from './logger'
import { APP_DIR, ROOT_DIR } from './root'
import { printStartupBanner } from './startup-banner'
import { staticAssets } from './static-assets'
import {
  initUpgradeSystem,
  registerShutdownForUpgrade,
  stopPeriodicCheck,
} from './upgrade/service'

// Migrate legacy global slash commands key to per-engine format, then load cache
void migrateSlashCommandsKey()
  .then(() => refreshSlashCommandsCache())
  .catch((err) => {
    logger.error({ err }, 'slash_commands_cache_load_failed')
  })

// Run startup reconciliation: mark stale sessions as failed and move
// orphaned working issues to review.
void startupReconciliation().catch((err) => {
  logger.error({ err }, 'startup_reconciliation_failed')
})

// Register event-driven reconciliation (fires after each process settles)
const stopSettledReconciliation = registerSettledReconciliation()

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
  // In package mode, static files live in APP_DIR/public/.
  // In dev mode, they live in apps/frontend/dist/.
  const staticRoot = APP_DIR
    ? resolve(APP_DIR, 'public')
    : resolve(ROOT_DIR, 'apps/frontend/dist')
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

printStartupBanner(listenHost, listenPort)

// Start periodic upload cleanup (removes files older than 7 days)
const stopUploadCleanup = startUploadCleanup()

// Start periodic worktree cleanup (removes worktrees for done issues older than 1 day)
const stopWorktreeCleanup = startWorktreeCleanup()

// Register shutdown callback for upgrade restarts (stops server + cancels engines)
registerShutdownForUpgrade(async () => {
  stopChangesSummaryWatcher()
  stopSettledReconciliation()
  stopPeriodicReconciliation()
  stopUploadCleanup()
  stopWorktreeCleanup()
  stopPeriodicCheck()
  await issueEngine.cancelAll()
  http.stop()
  logger.info('server_stopped_for_upgrade')
})

// Initialize upgrade system (check for updates on startup + periodic check)
void initUpgradeSystem().catch((err) => {
  logger.error({ err }, 'upgrade_system_init_failed')
})

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  logger.warn({ signal }, 'server_shutdown')

  // Stop SSE subscriptions and periodic jobs before cancelling processes
  stopChangesSummaryWatcher()
  stopSettledReconciliation()
  stopPeriodicReconciliation()
  stopUploadCleanup()
  stopWorktreeCleanup()
  stopPeriodicCheck()

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
