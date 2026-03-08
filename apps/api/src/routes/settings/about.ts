import { arch, platform } from 'node:os'
import { Hono } from 'hono'
import { getServerName, getServerUrl } from '@/db/helpers'
import { getVersionInfo } from '@/upgrade/service'

const about = new Hono()

const startedAt = Date.now()

// GET /api/settings/system-info
about.get('/system-info', async (c) => {
  const versionInfo = getVersionInfo()
  const [serverName, serverUrl] = await Promise.all([
    getServerName(),
    getServerUrl(),
  ])

  return c.json({
    success: true,
    data: {
      app: {
        version: versionInfo.version,
        commit: versionInfo.commit,
        isCompiled: versionInfo.isCompiled,
        isPackageMode: versionInfo.isPackageMode,
        startedAt: new Date(startedAt).toISOString(),
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      },
      runtime: {
        bun: Bun.version,
        platform: platform(),
        arch: arch(),
        nodeVersion: process.version,
      },
      server: {
        name: serverName,
        url: serverUrl,
      },
      process: {
        pid: process.pid,
      },
    },
  })
})

export default about
