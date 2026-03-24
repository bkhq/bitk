import { readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { getAppSetting } from '@/db/helpers'
import { runCommand } from '@/engines/spawn'
import type { Context } from 'hono'
import { createOpenAPIRouter } from '@/openapi/hono'

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

/** Return a Set of names that git considers ignored in the given directory. */
async function getGitIgnoredNames(dir: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    const paths = names.map(n => resolve(dir, n))
    const { code: exitCode, stdout } = await runCommand(
      ['git', 'check-ignore', '--', ...paths],
      { cwd: dir },
    )
    // exit code 1 means none matched
    if (exitCode !== 0 && exitCode !== 1) return new Set()
    const ignored = new Set<string>()
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const name = trimmed.split('/').pop()
      if (name) ignored.add(name)
    }
    return ignored
  } catch {
    return new Set()
  }
}

/** Resolve root from query param + validate sub-path stays inside it. */
async function resolveRootPath(c: Context, relativePath: string) {
  const rootParam = c.req.query('root')
  if (!rootParam) {
    return {
      error: c.json({ success: false, error: 'Missing required query parameter: root' }, 400),
    }
  }

  const root = resolve(rootParam)
  const target = resolve(root, relativePath)

  // SEC-007: Validate root is within workspace
  const workspaceRoot = await getAppSetting('workspace:defaultPath')
  if (workspaceRoot && workspaceRoot !== '/') {
    const resolvedWorkspace = resolve(workspaceRoot)
    if (!isInsideRoot(root, resolvedWorkspace)) {
      return {
        error: c.json({ success: false, error: 'Root is outside the configured workspace' }, 403),
      }
    }
  }

  if (!isInsideRoot(target, root)) {
    return {
      error: c.json({ success: false, error: 'Path is outside root directory' }, 403),
    }
  }

  return { root, target }
}

/**
 * Resolve the real on-disk path (following symlinks) and verify it stays inside root.
 * This prevents symlink traversal attacks on write operations.
 */
async function verifyRealPath(target: string, root: string): Promise<boolean> {
  try {
    const realTarget = await realpath(target)
    const realRoot = await realpath(root)
    return isInsideRoot(realTarget, realRoot)
  } catch {
    // If target doesn't exist yet (new file), check parent directory
    const parent = resolve(target, '..')
    try {
      const realParent = await realpath(parent)
      const realRoot = await realpath(root)
      return isInsideRoot(realParent, realRoot)
    } catch {
      return false
    }
  }
}

/** Extract relative path from the URL after the given marker segment. */
function extractPathAfter(c: Context, marker: string): string {
  const fullPath = new URL(c.req.url).pathname
  const idx = fullPath.indexOf(marker)
  if (idx < 0) return '.'
  const raw = fullPath.slice(idx + marker.length)
  if (!raw) return '.'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// ── /files/show — JSON browse (directory listing + file preview) ──

async function handleShow(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { root, target } = resolved

  // SEC-009: Verify real path after symlink resolution stays inside root
  if (!await verifyRealPath(target, root)) {
    return c.json({ success: false, error: 'Path escapes root via symlink' }, 403)
  }

  const hideIgnored = c.req.query('hideIgnored') === 'true'

  try {
    const targetStat = await stat(target)

    // ── File: return content as JSON ──
    if (targetStat.isFile()) {
      const relPath = target === root ? basename(target) : target.slice(root.length + 1)
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
    const validNames = dirents.filter(d => d.isFile() || d.isDirectory()).map(d => d.name)

    const ignoredNames = hideIgnored
      ? await getGitIgnoredNames(target, validNames)
      : new Set<string>()

    const entries: FileEntry[] = []

    for (const d of dirents) {
      if (!d.isFile() && !d.isDirectory()) continue
      if (d.name === '.git') continue
      if (ignoredNames.has(d.name)) continue

      let size = 0
      let modifiedAt = ''
      try {
        const s = await stat(resolve(target, d.name))
        size = s.size
        modifiedAt = s.mtime.toISOString()
      } catch {
        continue
      }

      entries.push({
        name: d.name,
        type: d.isDirectory() ? 'directory' : 'file',
        size,
        modifiedAt,
      })
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

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

// ── /files/raw — raw file download ──

async function handleRaw(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { root, target } = resolved

  // SEC-008: Verify real path after symlink resolution stays inside root
  if (!await verifyRealPath(target, root)) {
    return c.json({ success: false, error: 'Path escapes root via symlink' }, 403)
  }

  try {
    const targetStat = await stat(target)

    if (!targetStat.isFile()) {
      return c.json({ success: false, error: 'Path is not a file' }, 400)
    }

    const file = Bun.file(target)
    const fileName = basename(target)

    return new Response(file.stream(), {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Length': String(targetStat.size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false, error: 'Path not found' }, 404)
    }
    return c.json({ success: false, error: 'Failed to read file' }, 500)
  }
}

// ── /files/delete — delete file or directory ──

async function handleDelete(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { target, root } = resolved

  // Prevent deleting the root directory itself
  if (target === root) {
    return c.json({ success: false, error: 'Cannot delete root directory' }, 400)
  }

  // SEC: Verify real path after symlink resolution stays inside root
  if (!await verifyRealPath(target, root)) {
    return c.json({ success: false, error: 'Path escapes root via symlink' }, 403)
  }

  try {
    const targetStat = await stat(target)
    const isDir = targetStat.isDirectory()
    await rm(target, { recursive: isDir })

    return c.json({ success: true, data: { deleted: true } })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false, error: 'Path not found' }, 404)
    }
    return c.json({ success: false, error: 'Failed to delete' }, 500)
  }
}

// ── /files/save — save text file content ──

const MAX_SAVE_SIZE = 5 * 1024 * 1024 // 5 MB

async function handleSave(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { target, root } = resolved

  // SEC: Verify real path after symlink resolution stays inside root
  if (!await verifyRealPath(target, root)) {
    return c.json({ success: false, error: 'Path escapes root via symlink' }, 403)
  }

  try {
    const body = await c.req.json<{ content: string }>()
    if (typeof body.content !== 'string') {
      return c.json({ success: false, error: 'Missing required field: content' }, 400)
    }

    // SEC: Limit content size to prevent memory/disk abuse
    if (Buffer.byteLength(body.content, 'utf-8') > MAX_SAVE_SIZE) {
      return c.json({ success: false, error: `Content exceeds maximum size of ${MAX_SAVE_SIZE / 1024 / 1024} MB` }, 400)
    }

    await writeFile(target, body.content, 'utf-8')

    const fileStat = await stat(target)
    return c.json({
      success: true,
      data: { size: fileStat.size, modifiedAt: fileStat.mtime.toISOString() },
    })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false, error: 'Path not found' }, 404)
    }
    return c.json({ success: false, error: 'Failed to save file' }, 500)
  }
}

const files = createOpenAPIRouter()

// GET /files/show?root=... — root directory listing
files.get('/show', c => handleShow(c, '.'))
// GET /files/show/*?root=... — browse any sub-path
files.get('/show/*', c => handleShow(c, extractPathAfter(c, '/show/')))

// GET /files/raw/*?root=... — download raw file
files.get('/raw/*', c => handleRaw(c, extractPathAfter(c, '/raw/')))

// DELETE /files/delete/*?root=... — delete file or directory
files.delete('/delete/*', c => handleDelete(c, extractPathAfter(c, '/delete/')))

// PUT /files/save/*?root=... — save text file content
files.put('/save/*', c => handleSave(c, extractPathAfter(c, '/save/')))

export default files
