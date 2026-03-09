import { chmod, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '@/logger'
import { isPathWithinDir, VALID_FILE_NAME_RE } from '@/upgrade/utils'
import { VERSION } from '@/version'
import { computeFileSha256, fetchExpectedChecksum } from './checksum'
import { isPackageMode, UPDATES_DIR } from './constants'
import { ensureUpdatesDir } from './files'
import type { DownloadStatus } from './types'

// --- Module state ---

let downloadStatus: DownloadStatus = {
  status: 'idle',
  progress: 0,
  fileName: null,
  filePath: null,
  error: null,
  checksumMatch: null,
}

let isDownloading = false

export function getDownloadStatus(): DownloadStatus {
  return { ...downloadStatus }
}

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
      headers: { 'User-Agent': `bkd/${VERSION}` },
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

    // Stream directly to disk instead of buffering in memory
    const sink = Bun.file(tmpPath).writer()
    let received = 0
    const reader = body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sink.write(value)
        received += value.length

        if (contentLength > 0) {
          downloadStatus = {
            ...downloadStatus,
            progress: Math.round((received / contentLength) * 100),
          }
        }
      }
    } finally {
      await sink.end()
    }
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
          logger.error({ expected, actual, fileName }, 'upgrade_checksum_mismatch')
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
    logger.info({ fileName, filePath, size: received, checksumMatch }, 'upgrade_download_completed')
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
