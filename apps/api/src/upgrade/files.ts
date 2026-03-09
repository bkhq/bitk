import { existsSync, mkdirSync } from 'node:fs'
import { readdir, rm, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '@/logger'
import { isPathWithinDir, VALID_FILE_NAME_RE } from '@/upgrade/utils'
import { APP_BASE, UPDATES_DIR } from './constants'

/** Ensure the updates directory exists */
export function ensureUpdatesDir(): void {
  if (!existsSync(UPDATES_DIR)) {
    mkdirSync(UPDATES_DIR, { recursive: true })
  }
}

/** List downloaded update files (excluding .tmp partials) */
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
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    )
  } catch {
    return []
  }
}

/** Delete a downloaded update file by name */
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

/** Remove leftover .tmp files from interrupted downloads */
export async function cleanupTmpFiles(): Promise<void> {
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

/** Remove leftover .backup.* directories from interrupted upgrades in data/app/ */
export async function cleanupBackupDirs(): Promise<void> {
  if (!existsSync(APP_BASE)) return
  try {
    const entries = await readdir(APP_BASE)
    for (const name of entries) {
      if (name.includes('.backup.')) {
        const fullPath = resolve(APP_BASE, name)
        const s = await stat(fullPath).catch(() => null)
        if (s?.isDirectory()) {
          await rm(fullPath, { recursive: true }).catch(() => {})
          logger.info({ name }, 'upgrade_cleanup_backup_dir')
        }
      }
    }
  } catch {
    // ignore
  }
}
