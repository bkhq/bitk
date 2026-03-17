import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { logger } from './logger'
import { ROOT_DIR } from './root'

// ---------- Constants ----------

const PID_FILE_NAME = 'bkd.pid'
const UPGRADE_TOKEN_FILE_NAME = 'bkd.upgrade-token'
const HTTP_PROBE_TIMEOUT_MS = 2000

/**
 * Derive the PID lock file path from the same source as the SQLite DB,
 * so the lock always protects the correct database instance.
 *
 * Resolution order:
 *   1. Sibling of DB_PATH (e.g. `data/db/bkd.pid` next to `data/db/bkd.db`)
 *   2. BKD_DATA_DIR/bkd.pid
 *   3. <ROOT_DIR>/data/bkd.pid
 */
function getLockDir(): string {
  if (process.env.DB_PATH) {
    return dirname(
      process.env.DB_PATH.startsWith('/')
        ? process.env.DB_PATH
        : resolve(ROOT_DIR, process.env.DB_PATH),
    )
  }
  return process.env.BKD_DATA_DIR
    ? resolve(process.env.BKD_DATA_DIR)
    : resolve(ROOT_DIR, 'data')
}

function getPidFilePath(): string {
  return resolve(getLockDir(), PID_FILE_NAME)
}

function getUpgradeTokenPath(): string {
  return resolve(getLockDir(), UPGRADE_TOKEN_FILE_NAME)
}

// ---------- Helpers ----------

/**
 * Check whether a process with the given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check /proc/<pid>/cmdline (Linux only) for BKD-related keywords.
 * Returns `true` if the process looks like a BKD instance, `false` if
 * it is clearly something else, or `undefined` if /proc is unavailable.
 */
function isBkdByProcfs(pid: number): boolean | undefined {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    const normalized = cmdline.replaceAll('\0', ' ').toLowerCase()
    return normalized.includes('bkd') || normalized.includes('bun')
  } catch {
    return undefined
  }
}

/**
 * Probe the BKD HTTP health endpoint synchronously via curl.
 * Returns `true` if the endpoint responds with the expected BKD API identity,
 * `false` if the port is occupied by something else, or `undefined` on
 * connection errors (port not listening / timeout).
 */
function isBkdByHttpProbe(port: number): boolean | undefined {
  try {
    const result = Bun.spawnSync(
      ['curl', '-sf', '--max-time', String(HTTP_PROBE_TIMEOUT_MS / 1000), `http://127.0.0.1:${port}/api`],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    if (result.exitCode !== 0) return undefined
    const body = JSON.parse(result.stdout.toString()) as { success?: boolean, data?: { name?: string } }
    return body?.data?.name === 'bkd-api'
  } catch {
    return undefined
  }
}

/**
 * Determine whether the process holding the PID lock is truly a running
 * BKD instance. Combines three signals:
 *   1. kill(pid, 0) — is the process alive at all?
 *   2. /proc/<pid>/cmdline — does it look like bkd/bun? (Linux only)
 *   3. HTTP probe to the configured port — does it serve /api with name='bkd-api'?
 *
 * The HTTP probe is the strongest signal because it directly confirms the
 * service identity. Neither signal alone is sufficient to declare "not BKD"
 * because the binary may be compiled with a custom name (no "bkd"/"bun" in
 * cmdline) or the port may differ from the current env (HTTP inconclusive).
 * Only when both procfs AND HTTP actively deny BKD identity do we treat
 * the lock as stale.
 */
function isBkdProcessAlive(pid: number): boolean {
  if (!isProcessAlive(pid)) return false

  // --- procfs check (fast, Linux only) ---
  const procResult = isBkdByProcfs(pid)

  // --- HTTP probe (works on all platforms) ---
  const port = Number(process.env.PORT ?? 3000)
  const httpResult = isBkdByHttpProbe(port)

  // HTTP positively confirms BKD — strongest signal
  if (httpResult === true) return true

  // Both signals actively deny BKD identity — safe to treat as stale
  if (procResult === false && httpResult === false) {
    logger.info({ pid, port }, 'pid_lock_not_bkd_by_procfs_and_http')
    return false
  }

  // Only procfs denies but HTTP is inconclusive (connection refused / timeout).
  // The process may be a custom-named BKD binary that hasn't started listening
  // yet, or is listening on a different port. Err on the side of caution.
  if (procResult === false && httpResult === undefined) {
    logger.info({ pid, port }, 'pid_lock_procfs_mismatch_http_inconclusive')
    return true
  }

  // HTTP denies but procfs confirms or is unavailable — the port may have
  // been taken by another service while BKD is still alive on a different port
  if (httpResult === false) {
    logger.info({ pid, port }, 'pid_lock_http_mismatch_procfs_match')
    return procResult ?? true
  }

  // Both inconclusive — assume alive to avoid dual-instance corruption
  return true
}

/**
 * Atomically create a file with O_EXCL (fails if the file already exists).
 * Returns true if the file was created, false if it already existed.
 */
function tryCreateExclusive(filePath: string, content: string): boolean {
  try {
    // O_WRONLY | O_CREAT | O_EXCL — atomic create, fails with EEXIST if file exists
    const fd = openSync(filePath, 'wx')
    try {
      writeSync(fd, content, null, 'utf8')
    } finally {
      closeSync(fd)
    }
    return true
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

/**
 * Verify upgrade token: the upgrading process writes a file containing
 * its PID and a random nonce. The new process reads and validates both,
 * then deletes the token file. This prevents external spoofing — unlike
 * environment variables, the token file is protected by filesystem permissions.
 */
function isValidUpgradeToken(existingPid: number): boolean {
  const tokenPath = getUpgradeTokenPath()
  try {
    const content = readFileSync(tokenPath, 'utf8').trim()
    const [pidStr, nonce] = content.split(':')
    const tokenPid = Number.parseInt(pidStr ?? '', 10)

    if (tokenPid !== existingPid || !nonce || nonce.length < 16) {
      return false
    }

    // Token is valid — consume it (one-time use)
    try {
      unlinkSync(tokenPath)
    } catch { /* best effort */ }

    return true
  } catch {
    return false
  }
}

// ---------- Public API ----------

/**
 * Write an upgrade token file that authorises the new process to take
 * over the PID lock from this process. Called by the upgrade system
 * just before spawning the replacement process.
 */
export function writeUpgradeToken(): void {
  const tokenPath = getUpgradeTokenPath()
  const nonce = randomBytes(16).toString('hex')
  const content = `${process.pid}:${nonce}`
  mkdirSync(dirname(tokenPath), { recursive: true })
  writeFileSync(tokenPath, content, 'utf8')
  logger.debug({ tokenPath }, 'upgrade_token_written')
}

/**
 * Acquire a PID lock. If another BKD instance is already running,
 * log an error and exit immediately to prevent dual-instance corruption.
 *
 * Uses O_EXCL for atomic file creation to prevent TOCTOU races where
 * two processes both pass the existence check and write their PIDs.
 *
 * Call this synchronously at the very start of server initialisation,
 * before Bun.serve() or any reconciliation logic.
 */
export function acquirePidLock(): void {
  const pidFile = getPidFilePath()
  const dir = dirname(pidFile)
  mkdirSync(dir, { recursive: true })

  // Fast path: atomically create the lock file. If it succeeds, we own the lock.
  if (tryCreateExclusive(pidFile, String(process.pid))) {
    logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
    return
  }

  // Lock file already exists — check if the owning process is still alive.
  let existingPid = Number.NaN
  try {
    const content = readFileSync(pidFile, 'utf8').trim()
    existingPid = Number.parseInt(content, 10)
  } catch (err) {
    // Corrupt or unreadable PID file — remove and retry
    logger.warn({ err, pidFile }, 'pid_lock_corrupt_removed')
    try {
      unlinkSync(pidFile)
    } catch { /* best effort */ }
    if (tryCreateExclusive(pidFile, String(process.pid))) {
      logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
      return
    }
    // Another process beat us to it
    exitDuplicateInstance(pidFile, Number.NaN)
  }

  if (!Number.isNaN(existingPid) && existingPid > 0 && isBkdProcessAlive(existingPid)) {
    // Allow takeover when the upgrading process left a valid token file.
    // The token contains the parent's PID + a random nonce, so it cannot
    // be forged via environment variables or command-line arguments.
    if (isValidUpgradeToken(existingPid)) {
      logger.info(
        { existingPid, pidFile },
        'pid_lock_takeover_from_upgrade_parent',
      )
    } else {
      exitDuplicateInstance(pidFile, existingPid)
    }
  } else {
    // PID file exists but the process is dead → stale lock
    logger.warn(
      { stalePid: existingPid, pidFile },
      'pid_lock_stale_removed',
    )
  }

  // Remove stale/takeover lock and write our PID
  try {
    unlinkSync(pidFile)
  } catch { /* best effort */ }
  if (tryCreateExclusive(pidFile, String(process.pid))) {
    logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
    return
  }

  // Extremely unlikely: another process created the file between unlink and open
  exitDuplicateInstance(pidFile, Number.NaN)
}

function exitDuplicateInstance(pidFile: string, existingPid: number): never {
  const pidMsg = existingPid > 0 ? ` (PID ${existingPid})` : ''
  logger.fatal(
    { existingPid: existingPid || undefined, pidFile },
    'pid_lock_failed_another_instance_running',
  )
  console.error(
    `[bkd] Another instance is already running${pidMsg}. `
    + `If this is incorrect, remove the stale lock file: ${pidFile}`,
  )
  process.exit(1)
}

/**
 * Release the PID lock. Only removes the file if it still contains
 * the current process's PID (guards against a race where a new
 * instance has already written its own PID).
 */
export function releasePidLock(): void {
  const pidFile = getPidFilePath()

  try {
    let content: string
    try {
      content = readFileSync(pidFile, 'utf8').trim()
    } catch {
      return // file doesn't exist or unreadable — nothing to release
    }

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
