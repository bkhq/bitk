import { mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'
import { getAppSetting } from '@/db/helpers'

/** Check that `target` is inside `root` (or equals it). */
function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`)
}

const filesystem = new Hono()

filesystem.get('/dirs', async (c) => {
  const workspaceRoot = await getAppSetting('workspace:defaultPath')
  const resolvedRoot = workspaceRoot ? resolve(workspaceRoot) : null

  const raw = c.req.query('path') || resolvedRoot || process.cwd()
  const current = resolve(raw)

  // SEC-022: Restrict to workspace root (unless root is '/')
  if (
    resolvedRoot &&
    resolvedRoot !== '/' &&
    !isInsideRoot(current, resolvedRoot)
  ) {
    return c.json(
      { success: false, error: 'Path is outside the configured workspace' },
      403,
    )
  }

  // Compute parent — clamp to workspace root
  let parent: string | null =
    dirname(current) !== current ? dirname(current) : null
  if (
    parent &&
    resolvedRoot &&
    resolvedRoot !== '/' &&
    !isInsideRoot(parent, resolvedRoot)
  ) {
    parent = null
  }

  try {
    const entries = await readdir(current, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))

    return c.json({
      success: true,
      data: { current, parent, dirs },
    })
  } catch {
    return c.json({
      success: true,
      data: { current, parent, dirs: [] },
    })
  }
})

const createDirSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(255),
})

filesystem.post(
  '/dirs',
  zValidator('json', createDirSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map((i) => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { path: parentPath, name } = c.req.valid('json')

    // SEC-022: Validate name is a simple basename (no path traversal)
    if (name !== basename(name) || name === '.' || name === '..') {
      return c.json({ success: false, error: 'Invalid directory name' }, 400)
    }

    const target = resolve(parentPath, name)

    // SEC-022: Restrict to workspace root
    const workspaceRoot = await getAppSetting('workspace:defaultPath')
    if (workspaceRoot && workspaceRoot !== '/') {
      const resolvedRoot = resolve(workspaceRoot)
      if (!isInsideRoot(target, resolvedRoot)) {
        return c.json(
          { success: false, error: 'Path is outside the configured workspace' },
          403,
        )
      }
    }

    try {
      await mkdir(target, { recursive: true })
      return c.json({ success: true, data: { path: target } }, 201)
    } catch {
      return c.json(
        { success: false, error: 'Failed to create directory' },
        500,
      )
    }
  },
)

export default filesystem
