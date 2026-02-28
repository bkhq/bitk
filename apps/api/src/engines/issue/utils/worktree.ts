import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { logger } from '@/logger'

// ---------- Git commit hash ----------

export async function captureBaseCommitHash(workingDir: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: workingDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) return null
    const hash = stdout.trim()
    if (!/^[0-9a-f]{40}$/i.test(hash)) return null
    return hash
  } catch {
    return null
  }
}

// ---------- Git worktree helpers ----------

export async function createWorktree(baseDir: string, issueId: string): Promise<string> {
  const branchName = `bitk/${issueId}`
  const worktreeDir = join(baseDir, WORKTREE_DIR, issueId)
  await mkdir(join(baseDir, WORKTREE_DIR), { recursive: true })

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
  try {
    const proc = Bun.spawn(['git', 'worktree', 'remove', '--force', worktreeDir], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await proc.exited
    logger.debug({ worktreeDir }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir, error }, 'worktree_remove_failed')
    // Fallback: just delete the directory
    try {
      await rm(worktreeDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
