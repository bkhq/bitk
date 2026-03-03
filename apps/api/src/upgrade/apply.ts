import { existsSync, mkdirSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '@/logger'
import { isPathWithinDir, parseVersionFromFileName } from '@/upgrade/utils'
import { APP_BASE, isPackageMode, UPDATES_DIR, VERSION_FILE } from './constants'
import { getDownloadStatus } from './download'

// --- Shutdown registration ---

let registeredShutdownFn: (() => Promise<void>) | null = null

/** Register a callback that performs graceful shutdown (stop server, cancel engines, etc.) */
export function registerShutdownForUpgrade(fn: () => Promise<void>): void {
  registeredShutdownFn = fn
}

// --- Archive extraction (package mode) ---

async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<void> {
  // Extract into a temp directory first, then atomically swap into place.
  // This preserves the existing version directory if extraction fails.
  const tmpDir = `${destDir}.tmp.${Date.now()}`
  mkdirSync(tmpDir, { recursive: true })

  try {
    const proc = Bun.spawn(
      [
        'tar',
        '-xzf',
        archivePath,
        '-C',
        tmpDir,
        '--no-same-owner',
        '--no-overwrite-dir',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Failed to extract archive (exit ${exitCode}): ${stderr}`)
    }

    // Verify the extracted package contains server.js
    const serverPath = resolve(tmpDir, 'server.js')
    if (!existsSync(serverPath)) {
      throw new Error(
        'Invalid app package: missing server.js in extracted contents',
      )
    }

    // Swap: backup old version, rename temp into place, clean up backup
    const backupDir = `${destDir}.backup.${Date.now()}`
    if (existsSync(destDir)) {
      await rename(destDir, backupDir)
    }
    try {
      await rename(tmpDir, destDir)
      // Success: clean up backup
      if (existsSync(backupDir)) {
        await rm(backupDir, { recursive: true }).catch(() => {})
      }
    } catch (swapErr) {
      // Rollback: restore the backup
      if (existsSync(backupDir)) {
        await rename(backupDir, destDir).catch(() => {})
      }
      await rm(tmpDir, { recursive: true }).catch(() => {})
      throw swapErr
    }
  } catch (err) {
    // Clean up temp directory on any failure
    await rm(tmpDir, { recursive: true }).catch(() => {})
    throw err
  }

  logger.info({ archivePath, destDir }, 'upgrade_archive_extracted')
}

// --- Apply & restart ---

let isApplying = false

export async function applyUpgradeAndRestart(): Promise<void> {
  if (isApplying) {
    throw new Error('An upgrade is already being applied')
  }
  isApplying = true

  try {
    const status = getDownloadStatus()
    // 'verified' = checksum matched; 'completed' = no checksumUrl was provided.
    // Auto-downloads always include a checksumUrl when available; 'completed'
    // only occurs for manual API calls that omit the optional checksumUrl.
    if (status.status !== 'verified' && status.status !== 'completed') {
      throw new Error('No verified upgrade ready to apply')
    }
    if (!status.filePath || !existsSync(status.filePath)) {
      throw new Error('Upgrade file not found')
    }

    if (isPackageMode) {
      // Package mode: extract to data/app/v{version}/, update current pointer, restart
      const version = parseVersionFromFileName(status.fileName ?? '')
      if (!version) {
        throw new Error(
          `Cannot determine version from filename: ${status.fileName}`,
        )
      }

      const versionDir = resolve(APP_BASE, `v${version}`)
      logger.info(
        { archivePath: status.filePath, versionDir },
        'upgrade_extracting_package',
      )
      await extractArchive(status.filePath, versionDir)

      // Activate the new version
      await Bun.write(
        VERSION_FILE,
        JSON.stringify({
          version,
          updatedAt: new Date().toISOString(),
        }),
      )
      logger.info({ version }, 'upgrade_version_activated')

      // Graceful shutdown
      if (registeredShutdownFn) {
        await registeredShutdownFn()
      } else {
        logger.warn('upgrade_no_shutdown_fn_registered')
      }

      // Re-exec the launcher binary (process.execPath is the launcher)
      const child = Bun.spawn([process.execPath], {
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      child.unref()

      logger.info('upgrade_shutting_down_for_restart')
      process.exit(0)
    } else {
      // Binary mode: spawn the new binary directly
      const upgradeBinary = status.filePath

      // Verify the binary is within the updates directory
      if (!isPathWithinDir(upgradeBinary, UPDATES_DIR)) {
        throw new Error('Upgrade binary path is outside the updates directory')
      }

      logger.info(
        { from: process.execPath, to: upgradeBinary },
        'upgrade_applying',
      )

      // Graceful shutdown: stop server, cancel engine processes, release port
      if (registeredShutdownFn) {
        await registeredShutdownFn()
      } else {
        logger.warn('upgrade_no_shutdown_fn_registered')
      }

      // Spawn the new binary as a detached process after port is released
      const child = Bun.spawn([upgradeBinary], {
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      child.unref()

      logger.info('upgrade_shutting_down_for_restart')
      process.exit(0)
    }
  } catch (err) {
    isApplying = false
    throw err
  }
}
