import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
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

/** Return a Set of names that git considers ignored in the given directory. */
async function getGitIgnoredNames(
  dir: string,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    const paths = names.map((n) => resolve(dir, n))
    const proc = Bun.spawn(['git', 'check-ignore', '--', ...paths], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
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

/** Resolve project root + validate path is inside it. */
async function resolveProjectPath(c: Context, relativePath: string) {
  const projectId = c.req.param('projectId') as string
  const project = await findProject(projectId)
  if (!project) {
    return {
      error: c.json({ success: false, error: 'Project not found' }, 404),
    }
  }
  if (!project.directory) {
    return {
      error: c.json(
        { success: false, error: 'Project has no directory configured' },
        400,
      ),
    }
  }

  const root = resolve(project.directory)
  const target = resolve(root, relativePath)

  if (!isInsideRoot(target, root)) {
    return {
      error: c.json(
        { success: false, error: 'Path is outside project directory' },
        403,
      ),
    }
  }

  return { root, target }
}

/** Extract relative path from the URL after the given marker segment. */
function extractPathAfter(c: Context, marker: string): string {
  const fullPath = new URL(c.req.url).pathname
  const idx = fullPath.indexOf(marker)
  if (idx < 0) return '.'
  const raw = fullPath.slice(idx + marker.length)
  if (!raw) return '.'
  return decodeURIComponent(raw)
}

// ── /files/show — JSON browse (directory listing + file preview) ──

async function handleShow(c: Context, relativePath: string) {
  const resolved = await resolveProjectPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { root, target } = resolved

  const hideIgnored = c.req.query('hideIgnored') === 'true'

  try {
    const targetStat = await stat(target)

    // ── File: return content as JSON ──
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
    const validNames = dirents
      .filter((d) => d.isFile() || d.isDirectory())
      .map((d) => d.name)

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
  const resolved = await resolveProjectPath(c, relativePath)
  if ('error' in resolved) return resolved.error
  const { target } = resolved

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

const files = new Hono()

// GET /files/show — root directory listing
files.get('/show', (c) => handleShow(c, '.'))
// GET /files/show/* — browse any sub-path
files.get('/show/*', (c) => handleShow(c, extractPathAfter(c, '/show/')))

// GET /files/raw/* — download raw file
files.get('/raw/*', (c) => handleRaw(c, extractPathAfter(c, '/raw/')))

export default files
