import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import * as z from 'zod'
import { db } from '@/db'
import {
  attachments,
  issueLogs,
  issuesLogsToolsCall,
  issues as issuesTable,
  projects as projectsTable,
} from '@/db/schema'
import { removeWorktree, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'
import { APP_BASE, UPDATES_DIR } from '@/upgrade/constants'

const cleanup = new Hono()

// GET /api/settings/cleanup/stats — get sizes of cleanable data
cleanup.get('/cleanup/stats', async (c) => {
  const [logsResult, oldVersionsResult, worktreesResult, deletedIssuesResult] =
    await Promise.all([
      getLogsStats(),
      getOldVersionsStats(),
      getWorktreesStats(),
      getDeletedIssuesStats(),
    ])
  return c.json({
    success: true,
    data: {
      logs: logsResult,
      oldVersions: oldVersionsResult,
      worktrees: worktreesResult,
      deletedIssues: deletedIssuesResult,
    },
  })
})

// POST /api/settings/cleanup — run cleanup for specified targets
cleanup.post(
  '/cleanup',
  zValidator(
    'json',
    z.object({
      targets: z
        .array(z.enum(['logs', 'oldVersions', 'worktrees', 'deletedIssues']))
        .min(1),
    }),
    (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error.issues.map((i) => i.message).join(', '),
          },
          400,
        )
      }
    },
  ),
  async (c) => {
    const { targets } = c.req.valid('json')
    const results: Record<string, { cleaned: number }> = {}

    for (const target of targets) {
      try {
        switch (target) {
          case 'logs':
            results.logs = await cleanupLogs()
            break
          case 'oldVersions':
            results.oldVersions = await cleanupOldVersions()
            break
          case 'worktrees':
            results.worktrees = await cleanupWorktrees()
            break
          case 'deletedIssues':
            results.deletedIssues = await cleanupDeletedIssues()
            break
        }
      } catch (err) {
        logger.error({ target, err }, 'cleanup_target_failed')
        results[target] = { cleaned: 0 }
      }
    }

    return c.json({ success: true, data: results })
  },
)

// --- Stats helpers ---

async function getLogsStats() {
  // Count logs/tools only for soft-deleted issues (matching cleanup scope)
  const deletedIssueIds = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(eq(issuesTable.isDeleted, 1))
  const ids = deletedIssueIds.map((i) => i.id)
  if (ids.length === 0) return { logCount: 0, toolCallCount: 0 }

  const [logCount] = await db
    .select({ count: count() })
    .from(issueLogs)
    .where(inArray(issueLogs.issueId, ids))
  const [toolCallCount] = await db
    .select({ count: count() })
    .from(issuesLogsToolsCall)
    .where(inArray(issuesLogsToolsCall.issueId, ids))
  return {
    logCount: logCount?.count ?? 0,
    toolCallCount: toolCallCount?.count ?? 0,
  }
}

async function getOldVersionsStats() {
  const items: Array<{ name: string; size: number }> = []

  // Check data/updates/
  if (existsSync(UPDATES_DIR)) {
    try {
      const entries = await readdir(UPDATES_DIR)
      for (const name of entries) {
        const fp = resolve(UPDATES_DIR, name)
        const s = await stat(fp).catch(() => null)
        if (s) items.push({ name, size: s.size })
      }
    } catch {
      // ignore
    }
  }

  // Check data/app/ for old version directories (keep the current one)
  if (existsSync(APP_BASE)) {
    try {
      const entries = await readdir(APP_BASE)
      let currentVersionDir: string | null = null
      const versionFile = resolve(APP_BASE, 'version.json')
      if (existsSync(versionFile)) {
        try {
          const vj = await Bun.file(versionFile).json()
          if (vj?.version) currentVersionDir = `v${vj.version}`
        } catch {
          // ignore
        }
      }

      for (const name of entries) {
        if (name === 'version.json') continue
        if (currentVersionDir && name === currentVersionDir) continue
        const fp = resolve(APP_BASE, name)
        const s = await stat(fp).catch(() => null)
        if (s?.isDirectory()) {
          items.push({ name, size: await getDirSize(fp) })
        }
      }
    } catch {
      // ignore
    }
  }

  return { items, totalSize: items.reduce((sum, i) => sum + i.size, 0) }
}

async function getWorktreesStats() {
  let wtCount = 0
  let totalSize = 0

  if (!existsSync(WORKTREE_BASE)) return { count: 0, totalSize: 0 }

  try {
    const projectEntries = await readdir(WORKTREE_BASE, { withFileTypes: true })
    for (const pe of projectEntries) {
      if (!pe.isDirectory()) continue
      const projectDir = resolve(WORKTREE_BASE, pe.name)
      const issueEntries = await readdir(projectDir, {
        withFileTypes: true,
      }).catch(() => [])
      for (const ie of issueEntries) {
        if (!ie.isDirectory()) continue
        wtCount++
        totalSize += await getDirSize(resolve(projectDir, ie.name))
      }
    }
  } catch {
    // ignore
  }

  return { count: wtCount, totalSize }
}

async function getDeletedIssuesStats() {
  const deletedIssues = await db
    .select({ count: count() })
    .from(issuesTable)
    .where(eq(issuesTable.isDeleted, 1))
  const deletedProjects = await db
    .select({ count: count() })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, 1))
  return {
    issueCount: deletedIssues[0]?.count ?? 0,
    projectCount: deletedProjects[0]?.count ?? 0,
  }
}

async function getDirSize(dirPath: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fp = resolve(dirPath, entry.name)
      if (entry.isDirectory()) {
        size += await getDirSize(fp)
      } else {
        const s = await stat(fp).catch(() => null)
        if (s) size += s.size
      }
    }
  } catch {
    // ignore
  }
  return size
}

// --- Cleanup actions ---

async function cleanupLogs(): Promise<{ cleaned: number }> {
  // Only clean logs/tools/attachments for soft-deleted issues
  const deletedIssues = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(eq(issuesTable.isDeleted, 1))

  const issueIds = deletedIssues.map((i) => i.id)
  if (issueIds.length === 0) return { cleaned: 0 }

  const BATCH = 500
  let cleaned = 0
  for (let i = 0; i < issueIds.length; i += BATCH) {
    const batch = issueIds.slice(i, i + BATCH)
    // Delete tool calls first (FK dependency)
    await db
      .delete(issuesLogsToolsCall)
      .where(inArray(issuesLogsToolsCall.issueId, batch))
    // Delete attachments
    await db.delete(attachments).where(inArray(attachments.issueId, batch))
    // Delete logs
    await db.delete(issueLogs).where(inArray(issueLogs.issueId, batch))
    cleaned += batch.length
  }

  db.run(sql`VACUUM`)
  logger.info({ cleaned }, 'cleanup_logs_done')
  return { cleaned }
}

async function cleanupOldVersions(): Promise<{ cleaned: number }> {
  let cleaned = 0

  // Clean data/updates/
  if (existsSync(UPDATES_DIR)) {
    try {
      const entries = await readdir(UPDATES_DIR)
      for (const name of entries) {
        const fp = resolve(UPDATES_DIR, name)
        await rm(fp, { recursive: true }).catch(() => {})
        cleaned++
      }
    } catch {
      // ignore
    }
  }

  // Clean old version dirs in data/app/ (keep current)
  if (existsSync(APP_BASE)) {
    try {
      const entries = await readdir(APP_BASE)
      let currentVersionDir: string | null = null
      const versionFile = resolve(APP_BASE, 'version.json')
      if (existsSync(versionFile)) {
        try {
          const vj = await Bun.file(versionFile).json()
          if (vj?.version) currentVersionDir = `v${vj.version}`
        } catch {
          // ignore
        }
      }

      for (const name of entries) {
        if (name === 'version.json') continue
        if (currentVersionDir && name === currentVersionDir) continue
        const fp = resolve(APP_BASE, name)
        const s = await stat(fp).catch(() => null)
        if (s?.isDirectory()) {
          await rm(fp, { recursive: true }).catch(() => {})
          cleaned++
        }
      }
    } catch {
      // ignore
    }
  }

  logger.info({ cleaned }, 'cleanup_old_versions_done')
  return { cleaned }
}

async function cleanupWorktrees(): Promise<{ cleaned: number }> {
  let cleaned = 0

  if (!existsSync(WORKTREE_BASE)) return { cleaned: 0 }

  try {
    const projectEntries = await readdir(WORKTREE_BASE, { withFileTypes: true })
    for (const pe of projectEntries) {
      if (!pe.isDirectory()) continue
      const projectDir = resolve(WORKTREE_BASE, pe.name)
      const issueEntries = await readdir(projectDir, {
        withFileTypes: true,
      }).catch(() => [])
      for (const ie of issueEntries) {
        if (!ie.isDirectory()) continue
        const worktreePath = resolve(projectDir, ie.name)
        try {
          await removeWorktree(process.cwd(), worktreePath)
          cleaned++
        } catch {
          // Fallback: rm -rf if git worktree remove fails
          await rm(worktreePath, { recursive: true }).catch(() => {})
          cleaned++
        }
      }
      // Remove empty project directory
      const remaining = await readdir(projectDir).catch(() => [])
      if (remaining.length === 0) {
        await rm(projectDir, { recursive: true }).catch(() => {})
      }
    }
  } catch {
    // ignore
  }

  logger.info({ cleaned }, 'cleanup_worktrees_done')
  return { cleaned }
}

async function cleanupDeletedIssues(): Promise<{ cleaned: number }> {
  // Find all soft-deleted issues
  const deletedIssues = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(eq(issuesTable.isDeleted, 1))

  const deletedProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, 1))

  let cleaned = 0

  // Hard-delete in batches (issues + related data)
  const BATCH = 500
  const issueIds = deletedIssues.map((i) => i.id)
  for (let i = 0; i < issueIds.length; i += BATCH) {
    const batch = issueIds.slice(i, i + BATCH)
    // Delete related data first (FK order)
    await db
      .delete(issuesLogsToolsCall)
      .where(inArray(issuesLogsToolsCall.issueId, batch))
    await db.delete(attachments).where(inArray(attachments.issueId, batch))
    await db.delete(issueLogs).where(inArray(issueLogs.issueId, batch))
    await db.delete(issuesTable).where(inArray(issuesTable.id, batch))
    cleaned += batch.length
  }

  // Hard-delete soft-deleted projects
  const projectIds = deletedProjects.map((p) => p.id)
  for (let i = 0; i < projectIds.length; i += BATCH) {
    const batch = projectIds.slice(i, i + BATCH)
    await db.delete(projectsTable).where(inArray(projectsTable.id, batch))
    cleaned += batch.length
  }

  if (cleaned > 0) {
    db.run(sql`VACUUM`)
    logger.info({ cleaned }, 'cleanup_deleted_issues_done')
  }
  return { cleaned }
}

export default cleanup
