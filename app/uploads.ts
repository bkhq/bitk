import { mkdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { ulid } from 'ulid'

export const UPLOAD_DIR = resolve(process.cwd(), 'data/uploads')
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_FILES = 10

// MIME type prefixes that are safe to accept
const ALLOWED_MIME_PREFIXES = ['image/', 'text/', 'application/json', 'application/pdf']

// File extensions that are never allowed regardless of MIME type
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.dll',
  '.so',
  '.html',
  '.htm',
  '.svg',
])

export interface SavedFile {
  id: string
  originalName: string
  storedName: string
  mimeType: string
  size: number
  storagePath: string
  absolutePath: string
}

export async function saveUploadedFile(file: File): Promise<SavedFile> {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const id = ulid()
  const ext = extname(file.name) || ''
  const storedName = `${id}${ext}`
  const absolutePath = resolve(UPLOAD_DIR, storedName)
  const storagePath = `data/uploads/${storedName}`

  await Bun.write(absolutePath, file)

  return {
    id,
    originalName: file.name,
    storedName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    storagePath,
    absolutePath,
  }
}

export function validateFiles(files: File[]): { ok: true } | { ok: false; error: string } {
  if (files.length > MAX_FILES) {
    return { ok: false, error: `Too many files (max ${MAX_FILES})` }
  }
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        error: `File "${file.name}" exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
      }
    }

    const ext = extname(file.name).toLowerCase()
    if (ext && BLOCKED_EXTENSIONS.has(ext)) {
      return { ok: false, error: `File type "${ext}" is not allowed` }
    }

    // Allow empty or generic MIME (browser detection is unreliable for many types)
    const mime = file.type
    if (mime && mime !== 'application/octet-stream') {
      const allowed = ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
      if (!allowed) {
        return { ok: false, error: `MIME type "${mime}" is not allowed` }
      }
    }
  }
  return { ok: true }
}
