import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Hono } from 'hono'
import { findProject } from '@/db/helpers'
import { removeWorktree, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'

/** Only accept IDs that match the nanoid/ULID patterns used in the project */
const VALID_ID = /^[a-zA-Z0-9_-]{4,32}$/

interface WorktreeEntry {
  issueId: string
  path: string
  branch: string | null
}

async function listProjectWorktrees(projectId: string): Promise<WorktreeEntry[]> {
  const projectDir = join(WORKTREE_BASE, projectId)
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return []
  }

  const results: WorktreeEntry[] = []
  for (const name of entries) {
    // Skip entries that don't match expected ID format
    if (!VALID_ID.test(name)) continue

    const fullPath = join(projectDir, name)
    try {
      const s = await stat(fullPath)
      if (!s.isDirectory()) continue
    } catch {
      continue
    }

    // Try to read the branch from git HEAD
    let branch: string | null = null
    try {
      const gitFile = Bun.file(join(fullPath, '.git'))
      const content = await gitFile.text()
      // .git file in worktree contains "gitdir: ..." pointer
      if (content.startsWith('gitdir:')) {
        // Read HEAD from the main repo's worktrees/<name>/HEAD
        const gitdir = content.replace('gitdir:', '').trim()
        const headFile = Bun.file(join(gitdir, 'HEAD'))
        const head = await headFile.text()
        if (head.startsWith('ref: refs/heads/')) {
          branch = head.replace('ref: refs/heads/', '').trim()
        }
      }
    } catch {
      // Not a valid git worktree — still list it
    }

    results.push({ issueId: name, path: fullPath, branch })
  }

  return results.sort((a, b) => a.issueId.localeCompare(b.issueId))
}

const worktrees = new Hono()

// GET /api/projects/:projectId/worktrees — List worktrees for a project
worktrees.get('/', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const entries = await listProjectWorktrees(project.id)
  return c.json({ success: true, data: entries })
})

// DELETE /api/projects/:projectId/worktrees/:issueId — Force delete a worktree
worktrees.delete('/:issueId', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('issueId')!

  // Validate issueId format to prevent path traversal
  if (!VALID_ID.test(issueId)) {
    return c.json({ success: false, error: 'Invalid issueId' }, 400)
  }

  const baseWorktreeDir = resolve(join(WORKTREE_BASE, project.id))
  const worktreePath = resolve(join(baseWorktreeDir, issueId))

  // Ensure resolved path stays within the project worktree directory
  if (!worktreePath.startsWith(baseWorktreeDir + sep) && worktreePath !== baseWorktreeDir) {
    return c.json({ success: false, error: 'Invalid issueId' }, 400)
  }

  // Verify the worktree directory exists
  try {
    const s = await stat(worktreePath)
    if (!s.isDirectory()) {
      return c.json({ success: false, error: 'Worktree not found' }, 404)
    }
  } catch {
    return c.json({ success: false, error: 'Worktree not found' }, 404)
  }

  const baseDir = project.directory ? resolve(project.directory) : process.cwd()

  try {
    await removeWorktree(baseDir, worktreePath)
    logger.info({ projectId: project.id, issueId, worktreePath }, 'worktree_force_deleted')
  } catch (err) {
    logger.error(
      { projectId: project.id, issueId, worktreePath, err },
      'worktree_force_delete_failed',
    )
    return c.json({ success: false, error: 'Failed to delete worktree' }, 500)
  }

  return c.json({ success: true, data: { issueId } })
})

export default worktrees
