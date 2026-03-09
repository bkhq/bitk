import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

/** Resolve WORKTREE_DIR — absolute paths used as-is, relative resolved from ROOT_DIR */
export const WORKTREE_BASE = WORKTREE_DIR.startsWith('/')
  ? WORKTREE_DIR
  : join(ROOT_DIR, WORKTREE_DIR)

/** Safe root for rm fallback — never delete outside this directory */
const WORKTREE_SAFE_ROOT = WORKTREE_BASE

// ---------- Git worktree helpers ----------

/**
 * Deterministic worktree path: `<WORKTREE_BASE>/<projectId>/<issueId>/`
 */
export function resolveWorktreePath(projectId: string, issueId: string): string {
  return join(WORKTREE_BASE, projectId, issueId)
}

export async function createWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
): Promise<string> {
  const branchName = `bkd/${issueId}`
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  await mkdir(join(WORKTREE_BASE, projectId), { recursive: true })

  // Create worktree with a new branch off HEAD
  const proc = Bun.spawn(['git', 'worktree', 'add', '-b', branchName, worktreeDir], {
    cwd: baseDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    // Branch may already exist from a previous run — try without -b
    const retry = Bun.spawn(['git', 'worktree', 'add', worktreeDir, branchName], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const retryCode = await retry.exited
    if (retryCode !== 0) {
      const retryErr = await new Response(retry.stderr).text()
      throw new Error(`Failed to create worktree: ${stderr.trim()} / ${retryErr.trim()}`)
    }
  }
  logger.debug({ issueId, worktreeDir, branchName }, 'worktree_created')
  return worktreeDir
}

export async function removeWorktree(baseDir: string, worktreeDir: string): Promise<void> {
  const resolved = resolve(worktreeDir)
  try {
    const proc = Bun.spawn(['git', 'worktree', 'remove', '--force', resolved], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      throw new Error(`git worktree remove exited with code ${code}`)
    }
    logger.debug({ worktreeDir: resolved }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir: resolved, error }, 'worktree_remove_failed')
    // Containment guard: never rm outside the managed worktree directory
    if (!resolved.startsWith(WORKTREE_SAFE_ROOT + sep)) {
      logger.error(
        { worktreeDir: resolved, safeRoot: WORKTREE_SAFE_ROOT },
        'worktree_remove_path_escape_rejected',
      )
      return
    }
    // Fallback: just delete the directory
    try {
      await rm(resolved, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Verify that a worktree directory is registered under the given git repo.
 * Returns `true` if `git worktree list` from `baseDir` includes `worktreeDir`.
 */
export async function isWorktreeRegistered(baseDir: string, worktreeDir: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['git', 'worktree', 'list', '--porcelain'], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    // Read stdout concurrently with waiting for exit to avoid pipe buffer deadlock
    const [output] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (proc.exitCode !== 0) return false
    // Each worktree block starts with "worktree <absolute-path>"
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ') && line.slice(9) === worktreeDir) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Fire-and-forget worktree cleanup.
 * @param baseDir - The git repo directory that owns this worktree
 */
export function cleanupWorktree(baseDir: string, issueId: string, worktreePath: string): void {
  void removeWorktree(baseDir, worktreePath).catch((error) => {
    logger.warn({ issueId, worktreePath, error }, 'worktree_cleanup_failed')
  })
}
