import type { EngineType, NormalizedLogEntry, PermissionPolicy } from '../types'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { projects as projectsTable } from '../../db/schema'
import { logger } from '../../logger'
import { BUILT_IN_PROFILES } from '../types'

// ---------- Log visibility ----------

/**
 * Single visibility filter — everything is stored in DB, this controls display.
 * devMode=true shows all entries; devMode=false shows only user-facing entries.
 */
export function isVisibleForMode(entry: NormalizedLogEntry, devMode: boolean): boolean {
  if (devMode) return true

  // Meta-turn entries (auto-title etc.) are always hidden
  if (entry.metadata?.type === 'system') return false

  // User & assistant messages are always visible
  if (entry.entryType === 'user-message' || entry.entryType === 'assistant-message') return true

  // System messages — only command output and compact boundary
  if (entry.entryType === 'system-message') {
    const subtype = entry.metadata?.subtype
    return subtype === 'command_output' || subtype === 'compact_boundary'
  }

  return false
}

// ---------- Dev mode cache ----------

const devModeCache = new Map<string, boolean>()

export function getIssueDevMode(issueId: string): boolean {
  return devModeCache.get(issueId) ?? false
}

export function setIssueDevMode(issueId: string, devMode: boolean): void {
  devModeCache.set(issueId, devMode)
}

// ---------- Error classification ----------

export function isMissingExternalSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('no conversation found with session id') ||
    (msg.includes('no conversation found') && msg.includes('session id'))
  )
}

// ---------- Permission options ----------

export function getPermissionOptions(
  engineType: EngineType,
  overridePolicy?: PermissionPolicy,
): {
  permissionMode: string
} {
  const profile = BUILT_IN_PROFILES[engineType]
  const policy = overridePolicy ?? profile?.permissionPolicy ?? 'supervised'

  return { permissionMode: policy }
}

// ---------- Working directory ----------

export async function resolveWorkingDir(projectId: string): Promise<string> {
  const [project] = await db
    .select({ directory: projectsTable.directory })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  const dir = project?.directory ? resolve(project.directory) : process.cwd()
  await mkdir(dir, { recursive: true })
  const s = await stat(dir)
  if (!s.isDirectory()) {
    throw new Error(`Project directory is not a directory: ${dir}`)
  }
  return dir
}

// ---------- Git operations ----------

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
  const worktreeDir = join(baseDir, '.bitk-worktrees', issueId)
  await mkdir(join(baseDir, '.bitk-worktrees'), { recursive: true })

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
