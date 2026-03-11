import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { logger } from './logger'
import { ROOT_DIR } from './root'

// ---------- Constants ----------

const PID_FILE_NAME = 'bkd.pid'

function getPidFilePath(): string {
  const dataDir = process.env.BKD_DATA_DIR
    ? resolve(process.env.BKD_DATA_DIR)
    : resolve(ROOT_DIR, 'data')
  return resolve(dataDir, PID_FILE_NAME)
}

// ---------- Helpers ----------

/**
 * Check whether a process with the given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 doesn't kill — it just checks existence
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------- Public API ----------

/**
 * Acquire a PID lock. If another BKD instance is already running,
 * log an error and exit immediately to prevent dual-instance corruption.
 *
 * Call this synchronously at the very start of server initialisation,
 * before Bun.serve() or any reconciliation logic.
 */
export function acquirePidLock(): void {
  const pidFile = getPidFilePath()

  if (existsSync(pidFile)) {
    try {
      const content = readFileSync(pidFile, 'utf8').trim()
      const existingPid = Number.parseInt(content, 10)

      if (!Number.isNaN(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
        // Allow takeover when this process was spawned by an upgrade restart.
        // The parent set BKD_UPGRADE_FROM_PID to its own PID before spawning us;
        // if the lock belongs to that parent, it is about to exit — safe to take over.
        const upgradeFromPid = Number.parseInt(process.env.BKD_UPGRADE_FROM_PID ?? '', 10)
        if (existingPid === upgradeFromPid) {
          logger.info(
            { existingPid, pidFile },
            'pid_lock_takeover_from_upgrade_parent',
          )
          // Clear the env var so it doesn't leak to future child processes
          delete process.env.BKD_UPGRADE_FROM_PID
        } else {
          logger.fatal(
            { existingPid, pidFile },
            'pid_lock_failed_another_instance_running',
          )
          // Hard exit — do not run any cleanup as this instance never owned resources
          console.error(
            `[bkd] Another instance is already running (PID ${existingPid}). `
            + `If this is incorrect, remove the stale lock file: ${pidFile}`,
          )
          process.exit(1)
        }
      }

      // PID file exists but the process is dead → stale lock
      logger.warn(
        { stalePid: existingPid, pidFile },
        'pid_lock_stale_removed',
      )
    } catch (err) {
      // Corrupt PID file — remove and proceed
      logger.warn({ err, pidFile }, 'pid_lock_corrupt_removed')
    }
  }

  // Write current PID
  const dir = dirname(pidFile)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(pidFile, String(process.pid), 'utf8')

  logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
}

/**
 * Release the PID lock. Only removes the file if it still contains
 * the current process's PID (guards against a race where a new
 * instance has already written its own PID).
 */
export function releasePidLock(): void {
  const pidFile = getPidFilePath()

  try {
    if (!existsSync(pidFile)) return

    const content = readFileSync(pidFile, 'utf8').trim()
    const filePid = Number.parseInt(content, 10)

    if (filePid !== process.pid) {
      // Another instance already took over — don't delete their lock
      logger.debug(
        { filePid, currentPid: process.pid },
        'pid_lock_skip_release_not_owner',
      )
      return
    }

    unlinkSync(pidFile)
    logger.info({ pid: process.pid }, 'pid_lock_released')
  } catch (err) {
    // Best-effort removal — don't crash during shutdown
    logger.warn({ err }, 'pid_lock_release_failed')
  }
}
