import { existsSync, mkdirSync } from 'node:fs'
import { chmod, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { logger } from '@/logger'
import { APP_DIR, ROOT_DIR } from '@/root'
import {
  detectPlatformAssetSuffix,
  isNewerVersion,
  isPathWithinDir,
  parseVersionFromFileName,
  resolveDownloadFileName,
  VALID_FILE_NAME_RE,
} from '@/upgrade/utils'
import { COMMIT, VERSION } from '@/version'

// --- Constants ---

const UPGRADE_ENABLED_KEY = 'upgrade:enabled'
const UPGRADE_CHECK_RESULT_KEY = 'upgrade:lastCheckResult'
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

const UPDATES_DIR = resolve(ROOT_DIR, 'data/updates')
const APP_BASE = resolve(ROOT_DIR, 'data/app')
const VERSION_FILE = resolve(APP_BASE, 'version.json')

/** Whether the server is running from an extracted app package (launcher mode) */
const isPackageMode = APP_DIR !== null

export interface ReleaseInfo {
  version: string
  tag: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
  contentType: string
}

export interface UpgradeCheckResult {
  hasUpdate: boolean
  currentVersion: string
  currentCommit: string
  latestVersion: string | null
  latestTag: string | null
  publishedAt: string | null
  downloadUrl: string | null
  checksumUrl: string | null
  assetName: string | null
  assetSize: number | null
  downloadFileName: string | null
  checkedAt: string
}

export interface DownloadStatus {
  status:
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'verified'
    | 'completed'
    | 'failed'
  progress: number // 0-100
  fileName: string | null
  filePath: string | null
  error: string | null
  checksumMatch: boolean | null
}

// --- Module state ---

let downloadStatus: DownloadStatus = {
  status: 'idle',
  progress: 0,
  fileName: null,
  filePath: null,
  error: null,
  checksumMatch: null,
}

let periodicCheckTimer: ReturnType<typeof setInterval> | null = null
let registeredShutdownFn: (() => Promise<void>) | null = null

/** Register a callback that performs graceful shutdown (stop server, cancel engines, etc.) */
export function registerShutdownForUpgrade(fn: () => Promise<void>): void {
  registeredShutdownFn = fn
}

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
  } else {
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

// --- GitHub release detection ---

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/bkhq/bitk/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': `bitk/${VERSION}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (res.status === 404) {
      // No releases yet
      return null
    }

    if (!res.ok) {
      logger.warn(
        { status: res.status, statusText: res.statusText },
        'upgrade_fetch_release_failed',
      )
      return null
    }

    const data = (await res.json()) as {
      tag_name: string
      published_at: string
      html_url: string
      assets: Array<{
        name: string
        size: number
        browser_download_url: string
        content_type: string
      }>
    }

    return {
      version: data.tag_name.replace(/^v/, ''),
      tag: data.tag_name,
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      assets: data.assets.map((a) => ({
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url,
        contentType: a.content_type,
      })),
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'upgrade_fetch_release_error',
    )
    return null
  }
}

// --- Check for updates ---

export async function checkForUpdates(): Promise<UpgradeCheckResult> {
  const release = await fetchLatestRelease()
  const now = new Date().toISOString()

  if (!release) {
    const result: UpgradeCheckResult = {
      hasUpdate: false,
      currentVersion: VERSION,
      currentCommit: COMMIT,
      latestVersion: null,
      latestTag: null,
      publishedAt: null,
      downloadUrl: null,
      checksumUrl: null,
      assetName: null,
      assetSize: null,
      downloadFileName: null,
      checkedAt: now,
    }
    await setAppSetting(UPGRADE_CHECK_RESULT_KEY, JSON.stringify(result))
    return result
  }

  // In package mode, look for app package archives (e.g. bitk-app-v0.0.6.tar.gz).
  // In binary mode, look for platform-specific binaries (e.g. bitk-linux-x64-v0.0.6).
  let matchingAsset: ReleaseAsset | undefined
  if (isPackageMode) {
    matchingAsset = release.assets.find(
      (a) =>
        a.name.startsWith('bitk-app') &&
        a.name.endsWith('.tar.gz') &&
        !a.name.endsWith('.sha256'),
    )
  } else {
    const suffix = detectPlatformAssetSuffix()
    matchingAsset = release.assets.find(
      (a) =>
        a.name.includes(suffix) &&
        !a.name.endsWith('.sha256') &&
        !a.name.endsWith('.tar.gz'),
    )
  }
  // Find checksums.txt (preferred), fallback to legacy per-asset .sha256
  const checksumAsset =
    release.assets.find((a) => a.name === 'checksums.txt') ??
    release.assets.find((a) => a.name === `${matchingAsset?.name}.sha256`)
  // Only report an update if a newer version exists AND a matching asset is available
  const hasUpdate = !!matchingAsset && isNewerVersion(VERSION, release.version)

  const downloadFileName = matchingAsset
    ? resolveDownloadFileName(
        matchingAsset.name,
        release.version,
        isPackageMode,
      )
    : null

  const result: UpgradeCheckResult = {
    hasUpdate,
    currentVersion: VERSION,
    currentCommit: COMMIT,
    latestVersion: release.version,
    latestTag: release.tag,
    publishedAt: release.publishedAt,
    downloadUrl: matchingAsset?.downloadUrl ?? null,
    checksumUrl: checksumAsset?.downloadUrl ?? null,
    assetName: matchingAsset?.name ?? null,
    assetSize: matchingAsset?.size ?? null,
    downloadFileName,
    checkedAt: now,
  }

  await setAppSetting(UPGRADE_CHECK_RESULT_KEY, JSON.stringify(result))

  if (hasUpdate) {
    logger.info(
      {
        currentVersion: VERSION,
        latestVersion: release.version,
        hasMatchingAsset: !!matchingAsset,
        hasChecksum: !!checksumAsset,
      },
      'upgrade_available',
    )
  }

  return result
}

export async function getLastCheckResult(): Promise<UpgradeCheckResult | null> {
  const raw = await getAppSetting(UPGRADE_CHECK_RESULT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UpgradeCheckResult
  } catch {
    return null
  }
}

// --- SHA-256 verification ---

async function computeFileSha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  const data = await Bun.file(filePath).arrayBuffer()
  hasher.update(new Uint8Array(data))
  return hasher.digest('hex')
}

async function fetchExpectedChecksum(
  checksumUrl: string,
  assetName: string,
): Promise<string | null> {
  try {
    const res = await fetch(checksumUrl, {
      headers: { 'User-Agent': `bitk/${VERSION}` },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const text = await res.text()
    // Parse checksums.txt: each line is "<sha256>  <filename>"
    for (const line of text.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2 && parts[1] === assetName) {
        const hash = parts[0].toLowerCase()
        return /^[a-f0-9]{64}$/.test(hash) ? hash : null
      }
    }
    return null
  } catch {
    return null
  }
}

// --- Download ---

function ensureUpdatesDir(): void {
  if (!existsSync(UPDATES_DIR)) {
    mkdirSync(UPDATES_DIR, { recursive: true })
  }
}

export function getDownloadStatus(): DownloadStatus {
  return { ...downloadStatus }
}

let isDownloading = false

export async function downloadUpdate(
  url: string,
  fileName: string,
  checksumUrl?: string,
): Promise<void> {
  if (isDownloading) {
    throw new Error('A download is already in progress')
  }

  // Validate fileName to prevent path traversal
  if (!VALID_FILE_NAME_RE.test(fileName)) {
    throw new Error(`Invalid file name: ${fileName}`)
  }

  ensureUpdatesDir()
  const filePath = resolve(UPDATES_DIR, fileName)
  if (!isPathWithinDir(filePath, UPDATES_DIR)) {
    throw new Error('File path escapes updates directory')
  }

  isDownloading = true
  const tmpPath = `${filePath}.tmp`

  downloadStatus = {
    status: 'downloading',
    progress: 0,
    fileName,
    filePath,
    error: null,
    checksumMatch: null,
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `bitk/${VERSION}` },
      redirect: 'follow',
      signal: AbortSignal.timeout(300_000), // 5 min
    })

    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    }

    const contentLength = Number(res.headers.get('content-length') ?? 0)
    const body = res.body
    if (!body) {
      throw new Error('No response body')
    }

    const chunks: Uint8Array[] = []
    let received = 0
    const reader = body.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      received += value.length

      if (contentLength > 0) {
        downloadStatus = {
          ...downloadStatus,
          progress: Math.round((received / contentLength) * 100),
        }
      }
    }

    // Write to .tmp file first, then rename atomically
    const blob = new Blob(chunks)
    await Bun.write(tmpPath, blob)
    // Only set executable permissions for binary downloads, not archives
    if (!isPackageMode) {
      await chmod(tmpPath, 0o755)
    }

    // --- Verify checksum ---
    downloadStatus = {
      ...downloadStatus,
      status: 'verifying',
      progress: 100,
    }

    let checksumMatch: boolean | null = null
    if (checksumUrl) {
      const [actual, expected] = await Promise.all([
        computeFileSha256(tmpPath),
        fetchExpectedChecksum(checksumUrl, fileName),
      ])

      if (expected) {
        checksumMatch = actual === expected
        if (!checksumMatch) {
          logger.error(
            { expected, actual, fileName },
            'upgrade_checksum_mismatch',
          )
          await unlink(tmpPath).catch(() => {})
          isDownloading = false
          downloadStatus = {
            status: 'failed',
            progress: 0,
            fileName,
            filePath,
            error: `Checksum mismatch: expected ${expected.slice(0, 12)}..., got ${actual.slice(0, 12)}...`,
            checksumMatch: false,
          }
          return
        }
        logger.info({ sha256: actual, fileName }, 'upgrade_checksum_verified')
      } else {
        // Checksum URL was provided but we couldn't fetch it — fail safe
        logger.error({ checksumUrl }, 'upgrade_checksum_fetch_failed')
        await unlink(tmpPath).catch(() => {})
        isDownloading = false
        downloadStatus = {
          status: 'failed',
          progress: 0,
          fileName,
          filePath,
          error: 'Could not fetch checksum for verification',
          checksumMatch: null,
        }
        return
      }
    }

    // Atomically rename .tmp to final path
    await rename(tmpPath, filePath)

    downloadStatus = {
      status: checksumMatch === true ? 'verified' : 'completed',
      progress: 100,
      fileName,
      filePath,
      error: null,
      checksumMatch,
    }

    isDownloading = false
    logger.info(
      { fileName, filePath, size: received, checksumMatch },
      'upgrade_download_completed',
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    // Clean up partial .tmp file
    await unlink(tmpPath).catch(() => {})
    isDownloading = false
    downloadStatus = {
      status: 'failed',
      progress: 0,
      fileName,
      filePath,
      error: errorMsg,
      checksumMatch: null,
    }
    logger.error({ error: errorMsg, fileName }, 'upgrade_download_failed')
    throw err
  }
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
    const proc = Bun.spawn(['tar', '-xzf', archivePath, '-C', tmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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

// --- Restart ---

let isApplying = false

export async function applyUpgradeAndRestart(): Promise<void> {
  if (isApplying) {
    throw new Error('An upgrade is already being applied')
  }
  isApplying = true

  try {
    const status = getDownloadStatus()
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

// --- List downloaded updates ---

export async function listDownloadedUpdates(): Promise<
  Array<{ name: string; size: number; modifiedAt: string }>
> {
  ensureUpdatesDir()
  try {
    const entries = await readdir(UPDATES_DIR)
    const results = await Promise.all(
      entries
        .filter((name) => !name.endsWith('.tmp'))
        .map(async (name) => {
          const fp = resolve(UPDATES_DIR, name)
          const s = await stat(fp)
          return {
            name,
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
          }
        }),
    )
    return results.sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    )
  } catch {
    return []
  }
}

// --- Delete a downloaded update ---

export async function deleteDownloadedUpdate(fileName: string): Promise<void> {
  if (!VALID_FILE_NAME_RE.test(fileName)) {
    throw new Error(`Invalid file name: ${fileName}`)
  }
  const filePath = resolve(UPDATES_DIR, fileName)
  if (!isPathWithinDir(filePath, UPDATES_DIR)) {
    throw new Error('File path escapes updates directory')
  }
  await unlink(filePath)
}

// --- Periodic check ---

export function startPeriodicCheck(): void {
  stopPeriodicCheck()
  periodicCheckTimer = setInterval(() => {
    void isUpgradeEnabled().then((enabled) => {
      if (enabled) {
        void checkAndAutoDownload().catch((err) => {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            'upgrade_periodic_check_failed',
          )
        })
      }
    })
  }, CHECK_INTERVAL_MS)
}

async function checkAndAutoDownload(): Promise<void> {
  const result = await checkForUpdates()
  const fileName = result.downloadFileName
  if (
    result.hasUpdate &&
    result.downloadUrl &&
    fileName &&
    downloadStatus.status === 'idle'
  ) {
    logger.info(
      { version: result.latestVersion, fileName },
      'upgrade_auto_downloading',
    )
    await downloadUpdate(
      result.downloadUrl,
      fileName,
      result.checksumUrl ?? undefined,
    )
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

  const enabled = await isUpgradeEnabled()
  if (enabled) {
    // Do an initial check + auto-download if available
    void checkAndAutoDownload().catch((err) => {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'upgrade_initial_check_failed',
      )
    })
    startPeriodicCheck()
  }
  logger.info({ enabled }, 'upgrade_system_initialized')
}

async function cleanupTmpFiles(): Promise<void> {
  ensureUpdatesDir()
  try {
    const entries = await readdir(UPDATES_DIR)
    for (const name of entries) {
      if (name.endsWith('.tmp')) {
        await unlink(resolve(UPDATES_DIR, name)).catch(() => {})
        logger.info({ name }, 'upgrade_cleanup_tmp_file')
      }
    }
  } catch {
    // ignore
  }
}
