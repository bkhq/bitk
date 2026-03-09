import { getAppSetting, setAppSetting } from '@/db/helpers'
import { logger } from '@/logger'
import { COMMIT, VERSION } from '@/version'
import { checkForUpdates } from './checker'
import { CHECK_INTERVAL_MS, isPackageMode, UPGRADE_ENABLED_KEY } from './constants'
import { cleanupBackupDirs, cleanupTmpFiles } from './files'

// --- Re-exports (preserve public API for route consumers) ---

export { applyUpgradeAndRestart, registerShutdownForUpgrade } from './apply'

export { checkForUpdates, getLastCheckResult } from './checker'
export { downloadUpdate, getDownloadStatus } from './download'
export { deleteDownloadedUpdate, listDownloadedUpdates } from './files'
export type { DownloadStatus, ReleaseAsset, ReleaseInfo, UpgradeCheckResult } from './types'

// --- Settings ---

export async function isUpgradeEnabled(): Promise<boolean> {
  const value = await getAppSetting(UPGRADE_ENABLED_KEY)
  // Default to true if not set
  return value !== 'false'
}

export async function setUpgradeEnabled(enabled: boolean): Promise<void> {
  await setAppSetting(UPGRADE_ENABLED_KEY, String(enabled))
  if (enabled) {
    startPeriodicCheck()
  }
  else {
    stopPeriodicCheck()
  }
}

// --- Version info ---

export function getVersionInfo() {
  return {
    version: VERSION,
    commit: COMMIT,
    isCompiled: VERSION !== 'dev',
    isPackageMode,
  }
}

// --- Periodic check ---

let periodicCheckTimer: ReturnType<typeof setInterval> | null = null

export function startPeriodicCheck(): void {
  stopPeriodicCheck()
  periodicCheckTimer = setInterval(() => {
    void isUpgradeEnabled().then((enabled) => {
      if (enabled) {
        void checkForUpdates().catch((err) => {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            'upgrade_periodic_check_failed',
          )
        })
      }
    })
  }, CHECK_INTERVAL_MS)

  // Allow the process to exit without waiting for this timer
  if (
    periodicCheckTimer
    && typeof periodicCheckTimer === 'object'
    && 'unref' in periodicCheckTimer
  ) {
    periodicCheckTimer.unref()
  }
}

export function stopPeriodicCheck(): void {
  if (periodicCheckTimer) {
    clearInterval(periodicCheckTimer)
    periodicCheckTimer = null
  }
}

// --- Startup ---

export async function initUpgradeSystem(): Promise<void> {
  // Skip upgrade system entirely in dev mode
  if (VERSION === 'dev') {
    logger.info('upgrade_system_skipped_dev_mode')
    return
  }

  // Clean up any stale .tmp files from interrupted downloads
  await cleanupTmpFiles()

  // Clean up any leftover .backup.* directories from interrupted upgrades
  await cleanupBackupDirs()

  const enabled = await isUpgradeEnabled()
  if (enabled) {
    // Do an initial check (notify only, no auto-download)
    void checkForUpdates().catch((err) => {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'upgrade_initial_check_failed',
      )
    })
    startPeriodicCheck()
  }
  logger.info({ enabled }, 'upgrade_system_initialized')
}
