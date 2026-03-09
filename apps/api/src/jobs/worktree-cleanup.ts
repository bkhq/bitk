import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { and, eq, inArray, isNull, lte, notInArray, or } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { removeWorktree, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'

export const WORKTREE_AUTO_CLEANUP_KEY = 'worktree:autoCleanup'

/** Default interval: every 30 minutes */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000

/** Only clean up worktrees for issues that have been done for at least 1 day */
const DONE_AGE_MS = 24 * 60 * 60 * 1000

/** Max entries per inArray batch to stay within SQLite variable limits */
const MAX_BATCH = 500

async function isAutoCleanupEnabled(): Promise<boolean> {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return value === 'true'
}

async function runWorktreeCleanup(): Promise<void> {
  if (!(await isAutoCleanupEnabled())) return

  const worktreeBaseDir = WORKTREE_BASE
  let projectEntries: import('node:fs').Dirent[]
  try {
    projectEntries = await readdir(worktreeBaseDir, { withFileTypes: true })
  }
  catch {
    return // No worktree directory at all
  }

  const projectDirNames = projectEntries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .slice(0, MAX_BATCH)

  if (projectDirNames.length === 0) return

  // Batch-fetch all project directories upfront to avoid N+1 queries
  const projectRows = await db
    .select({ id: projectsTable.id, directory: projectsTable.directory })
    .from(projectsTable)
    .where(inArray(projectsTable.id, projectDirNames))
  const projectMap = new Map(projectRows.map(p => [p.id, p.directory]))

  const cutoff = new Date(Date.now() - DONE_AGE_MS)
  let cleaned = 0

  for (const projectDirName of projectDirNames) {
    const projectWorktreeDir = join(worktreeBaseDir, projectDirName)

    // List worktree subdirectories (issue IDs)
    let issueEntries: import('node:fs').Dirent[]
    try {
      issueEntries = await readdir(projectWorktreeDir, { withFileTypes: true })
    }
    catch {
      continue
    }

    const issueIds = issueEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .slice(0, MAX_BATCH)

    if (issueIds.length === 0) continue

    // Batch-query DB: find issues that are done + not deleted + use worktree + statusUpdatedAt <= cutoff
    const doneIssues = await db
      .select({
        id: issuesTable.id,
        projectId: issuesTable.projectId,
      })
      .from(issuesTable)
      .where(
        and(
          inArray(issuesTable.id, issueIds),
          eq(issuesTable.statusId, 'done'),
          eq(issuesTable.isDeleted, 0),
          eq(issuesTable.useWorktree, true),
          lte(issuesTable.statusUpdatedAt, cutoff),
          // Only clean worktrees when no active session exists
          or(
            isNull(issuesTable.sessionStatus),
            notInArray(issuesTable.sessionStatus, ['running', 'pending']),
          ),
        ),
      )

    if (doneIssues.length === 0) continue

    const directory = projectMap.get(projectDirName)
    const baseDir = directory ? resolve(directory) : process.cwd()

    for (const issue of doneIssues) {
      const worktreePath = join(projectWorktreeDir, issue.id)

      try {
        await removeWorktree(baseDir, worktreePath)
        cleaned++
        logger.debug(
          { projectId: issue.projectId, issueId: issue.id, worktreePath },
          'worktree_auto_cleaned',
        )
      }
      catch (err) {
        logger.warn(
          { projectId: issue.projectId, issueId: issue.id, err },
          'worktree_auto_cleanup_failed',
        )
      }
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'worktree_auto_cleanup_done')
  }
}

export function startWorktreeCleanup(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  // Run once immediately on startup to clean stale worktrees from before restart
  void runWorktreeCleanup().catch((err) => {
    logger.error({ err }, 'worktree_cleanup_job_error')
  })
  const timer = setInterval(() => {
    void runWorktreeCleanup().catch((err) => {
      logger.error({ err }, 'worktree_cleanup_job_error')
    })
  }, intervalMs)
  if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref()
  return () => clearInterval(timer)
}
