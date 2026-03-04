import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import { logger } from '@/logger'
import {
  applyUpgradeAndRestart,
  checkForUpdates,
  deleteDownloadedUpdate,
  downloadUpdate,
  getDownloadStatus,
  getLastCheckResult,
  getVersionInfo,
  isUpgradeEnabled,
  listDownloadedUpdates,
  setUpgradeEnabled,
} from '@/upgrade/service'
import { VALID_FILE_NAME_RE } from '@/upgrade/utils'

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
])

function isAllowedDownloadHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return ALLOWED_DOWNLOAD_HOSTS.has(hostname)
  } catch {
    return false
  }
}

const githubUrlSchema = z
  .string()
  .url()
  .refine(isAllowedDownloadHost, 'URL must be from GitHub')

const upgradeFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    VALID_FILE_NAME_RE,
    'File name must match bitk-<type>-v<version> format',
  )

const upgrade = new Hono()

// GET /api/upgrade/version — current version info
upgrade.get('/version', (c) => {
  const info = getVersionInfo()
  return c.json({ success: true, data: info })
})

// GET /api/upgrade/enabled — whether upgrade is enabled
upgrade.get('/enabled', async (c) => {
  const enabled = await isUpgradeEnabled()
  return c.json({ success: true, data: { enabled } })
})

// PATCH /api/upgrade/enabled — toggle upgrade on/off
upgrade.patch(
  '/enabled',
  zValidator('json', z.object({ enabled: z.boolean() }), (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: result.error.issues.map(i => i.message).join(', ') }, 400)
    }
  }),
  async (c) => {
    const { enabled } = c.req.valid('json')
    await setUpgradeEnabled(enabled)
    return c.json({ success: true, data: { enabled } })
  },
)

// GET /api/upgrade/check — check for updates (uses cache if recent)
upgrade.get('/check', async (c) => {
  const result = await getLastCheckResult()
  return c.json({ success: true, data: result })
})

// POST /api/upgrade/check — force-check for updates
upgrade.post('/check', async (c) => {
  const result = await checkForUpdates()
  return c.json({ success: true, data: result })
})

// POST /api/upgrade/download — download an update
upgrade.post(
  '/download',
  zValidator(
    'json',
    z.object({
      url: githubUrlSchema,
      fileName: upgradeFileNameSchema,
      checksumUrl: githubUrlSchema.optional(),
    }),
    (result, c) => {
      if (!result.success) {
        return c.json({ success: false, error: result.error.issues.map(i => i.message).join(', ') }, 400)
      }
    },
  ),
  async (c) => {
    const { url, fileName, checksumUrl } = c.req.valid('json')
    // Check status synchronously before starting background download
    const currentStatus = getDownloadStatus()
    if (
      currentStatus.status === 'downloading' ||
      currentStatus.status === 'verifying'
    ) {
      return c.json(
        { success: false, error: 'A download is already in progress' },
        409,
      )
    }
    // Start download in background; errors are tracked in downloadStatus
    downloadUpdate(url, fileName, checksumUrl).catch((err) => {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'upgrade_download_route_error',
      )
    })
    return c.json({ success: true, data: { status: 'started', fileName } })
  },
)

// GET /api/upgrade/download/status — check download progress
upgrade.get('/download/status', (c) => {
  const status = getDownloadStatus()
  return c.json({ success: true, data: status })
})

// POST /api/upgrade/restart — apply downloaded upgrade and restart
upgrade.post('/restart', async (c) => {
  try {
    await applyUpgradeAndRestart()
    return c.json({
      success: true,
      data: { status: 'restarting' },
    })
  } catch (err) {
    logger.error({ error: err }, 'upgrade_restart_failed')
    return c.json(
      {
        success: false,
        error: 'Failed to apply upgrade and restart',
      },
      400,
    )
  }
})

// GET /api/upgrade/downloads — list downloaded update files
upgrade.get('/downloads', async (c) => {
  const files = await listDownloadedUpdates()
  return c.json({ success: true, data: files })
})

// DELETE /api/upgrade/downloads/:fileName — delete a downloaded update
upgrade.delete(
  '/downloads/:fileName',
  zValidator(
    'param',
    z.object({
      fileName: upgradeFileNameSchema,
    }),
    (result, c) => {
      if (!result.success) {
        return c.json({ success: false, error: result.error.issues.map(i => i.message).join(', ') }, 400)
      }
    },
  ),
  async (c) => {
    const { fileName } = c.req.valid('param')
    try {
      await deleteDownloadedUpdate(fileName)
      return c.json({ success: true, data: { deleted: fileName } })
    } catch (err) {
      logger.error({ error: err, fileName }, 'upgrade_delete_failed')
      return c.json(
        {
          success: false,
          error: 'Failed to delete downloaded update',
        },
        404,
      )
    }
  },
)

export default upgrade
