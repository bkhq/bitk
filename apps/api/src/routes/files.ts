import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { findProject } from '@/db/helpers'

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

const MAX_FILE_SIZE = 1024 * 1024 // 1 MB

/** Check that `target` is inside `root` (or equals it). */
function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`)
}

/** Heuristic binary check: look for null bytes in the first 8KB. */
function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/** Extract the relative path after `/files/` from the full request path. */
function extractRelativePath(c: Context): string {
  const fullPath = new URL(c.req.url).pathname
  const marker = '/files/'
  const idx = fullPath.indexOf(marker)
  if (idx < 0) return '.'
  const raw = fullPath.slice(idx + marker.length)
  if (!raw) return '.'
  return decodeURIComponent(raw)
}

async function handleBrowse(c: Context, relativePath: string) {
  const projectId = c.req.param('projectId') as string
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }
  if (!project.directory) {
    return c.json(
      { success: false, error: 'Project has no directory configured' },
      400,
    )
  }

  const root = resolve(project.directory)
  const target = resolve(root, relativePath)

  if (!isInsideRoot(target, root)) {
    return c.json(
      { success: false, error: 'Path is outside project directory' },
      403,
    )
  }

  const showHidden = c.req.query('showHidden') === 'true'

  try {
    const targetStat = await stat(target)

    // ── File: return content directly ──
    if (targetStat.isFile()) {
      const relPath = target.slice(root.length + 1)
      const isTruncated = targetStat.size > MAX_FILE_SIZE
      const buf = Buffer.alloc(Math.min(targetStat.size, MAX_FILE_SIZE))

      const file = Bun.file(target)
      const slice = file.slice(0, MAX_FILE_SIZE)
      const arrayBuf = await slice.arrayBuffer()
      Buffer.from(arrayBuf).copy(buf)

      if (isBinaryBuffer(buf)) {
        return c.json({
          success: true,
          data: {
            path: relPath,
            type: 'file' as const,
            content: '',
            size: targetStat.size,
            isTruncated: false,
            isBinary: true,
          },
        })
      }

      return c.json({
        success: true,
        data: {
          path: relPath,
          type: 'file' as const,
          content: buf.toString('utf-8'),
          size: targetStat.size,
          isTruncated,
          isBinary: false,
        },
      })
    }

    // ── Directory: return entry listing ──
    const dirents = await readdir(target, { withFileTypes: true })
    const entries: FileEntry[] = []

    for (const d of dirents) {
      if (!showHidden && d.name.startsWith('.')) continue
      if (!d.isFile() && !d.isDirectory()) continue

      let size = 0
      let modifiedAt = ''
      try {
        const s = await stat(resolve(target, d.name))
        size = s.size
        modifiedAt = s.mtime.toISOString()
      } catch {
        // skip entries we can't stat
        continue
      }

      entries.push({
        name: d.name,
        type: d.isDirectory() ? 'directory' : 'file',
        size,
        modifiedAt,
      })
    }

    // directories first, then files; alphabetical within each group
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    // path relative to project root
    const relPath = target === root ? '.' : target.slice(root.length + 1)

    return c.json({
      success: true,
      data: { path: relPath, type: 'directory' as const, entries },
    })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false, error: 'Path not found' }, 404)
    }
    return c.json({ success: false, error: 'Failed to read path' }, 500)
  }
}

const files = new Hono()

// GET /files — root directory listing
files.get('/', (c) => handleBrowse(c, '.'))

// GET /files/* — browse any sub-path (file or directory)
files.get('/*', (c) => handleBrowse(c, extractRelativePath(c)))

export default files
