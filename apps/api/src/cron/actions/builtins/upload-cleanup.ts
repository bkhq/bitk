import { readdir, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { logger } from '@/logger'

const UPLOAD_DIR = resolve(process.cwd(), 'data/uploads')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function runUploadCleanup(): Promise<string> {
  const files = await readdir(UPLOAD_DIR).catch(() => [])
  const now = Date.now()
  let cleaned = 0
  for (const file of files) {
    const path = resolve(UPLOAD_DIR, file)
    const s = await stat(path).catch(() => null)
    if (s && now - s.mtimeMs > MAX_AGE_MS) {
      await unlink(path).catch(() => {})
      cleaned++
    }
  }
  if (cleaned > 0) logger.info({ cleaned }, 'upload_cleanup_done')
  return `cleaned ${cleaned} files`
}
