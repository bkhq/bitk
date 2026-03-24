import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
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
import { createOpenAPIRouter } from '@/openapi/hono'
import { ROOT_DIR } from '@/root'
import { APP_BASE, UPDATES_DIR } from '@/upgrade/constants'

const ISSUE_LOG_DIR = join(ROOT_DIR, 'data', 'logs', 'issues')

const cleanup = createOpenAPIRouter()

// GET /api/settings/cleanup/stats — get sizes of cleanable data
cleanup.get('/cleanup/stats', async (c) => {
  const [logsResult, oldVersionsResult, worktreesResult, deletedIssuesResult] = await Promise.all([
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
      targets: z.array(z.enum(['logs', 'oldVersions', 'worktrees', 'deletedIssues'])).min(1),
    }),
    (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error.issues.map(i => i.message).join(', '),
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

/** Check a set of issueIds against DB, return the ones that are alive (exist + not deleted). */
async function getAliveIssueIds(ids: string[]): Promise<Set<string>> {
  const BATCH = 500
  const aliveIds = new Set<string>()
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const rows = await db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(and(inArray(issuesTable.id, batch), eq(issuesTable.isDeleted, 0)))
    for (const r of rows) aliveIds.add(r.id)
  }
  return aliveIds
}

/** Scan issueLogs DB + log files on disk for issueIds whose issue is deleted or missing. */
async function scanCleanableLogIssueIds(): Promise<{ dbIds: string[], fileIds: string[] }> {
  // 1. Collect issueIds from DB logs
  const logIssueRows = await db
    .selectDistinct({ issueId: issueLogs.issueId })
    .from(issueLogs)
  const dbLogIds = logIssueRows.map(r => r.issueId)

  // 2. Collect issueIds from disk log directories
  const diskLogIds: string[] = []
  if (existsSync(ISSUE_LOG_DIR)) {
    try {
      const entries = await readdir(ISSUE_LOG_DIR, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) diskLogIds.push(e.name)
      }
    } catch {
      // ignore
    }
  }

  // 3. Union all ids, check which are alive
  const allIds = [...new Set([...dbLogIds, ...diskLogIds])]
  if (allIds.length === 0) return { dbIds: [], fileIds: [] }
  const aliveIds = await getAliveIssueIds(allIds)

  return {
    dbIds: dbLogIds.filter(id => !aliveIds.has(id)),
    fileIds: diskLogIds.filter(id => !aliveIds.has(id)),
  }
}

async function getLogsStats() {
  const { dbIds, fileIds } = await scanCleanableLogIssueIds()
  const issueCount = new Set([...dbIds, ...fileIds]).size
  if (issueCount === 0) return { issueCount: 0, logCount: 0, toolCallCount: 0, logFileSize: 0 }

  const BATCH = 500
  let logTotal = 0
  let toolTotal = 0
  for (let i = 0; i < dbIds.length; i += BATCH) {
    const batch = dbIds.slice(i, i + BATCH)
    const [lc] = await db
      .select({ count: count() })
      .from(issueLogs)
      .where(inArray(issueLogs.issueId, batch))
    const [tc] = await db
      .select({ count: count() })
      .from(issuesLogsToolsCall)
      .where(inArray(issuesLogsToolsCall.issueId, batch))
    logTotal += lc?.count ?? 0
    toolTotal += tc?.count ?? 0
  }

  let logFileSize = 0
  for (const id of fileIds) {
    logFileSize += await getDirSize(join(ISSUE_LOG_DIR, id))
  }

  return {
    issueCount,
    logCount: logTotal,
    toolCallCount: toolTotal,
    logFileSize,
  }
}

async function getOldVersionsStats() {
  const items: Array<{ name: string, size: number }> = []

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

/** Scan disk for all worktree issue IDs, then query DB for active ones. */
async function scanCleanableWorktrees(): Promise<Array<{ projectDir: string, issueId: string, path: string }>> {
  if (!existsSync(WORKTREE_BASE)) return []

  const allOnDisk: Array<{ projectDir: string, issueId: string, path: string }> = []
  try {
    const projectEntries = await readdir(WORKTREE_BASE, { withFileTypes: true })
    for (const pe of projectEntries) {
      if (!pe.isDirectory()) continue
      const projectDir = resolve(WORKTREE_BASE, pe.name)
      const issueEntries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
      for (const ie of issueEntries) {
        if (!ie.isDirectory()) continue
        allOnDisk.push({ projectDir, issueId: ie.name, path: resolve(projectDir, ie.name) })
      }
    }
  } catch {
    // ignore
  }
  if (allOnDisk.length === 0) return []

  const diskIds = [...new Set(allOnDisk.map(w => w.issueId))]
  const aliveIds = await getAliveIssueIds(diskIds)
  return allOnDisk.filter(w => !aliveIds.has(w.issueId))
}

async function getWorktreesStats() {
  const cleanable = await scanCleanableWorktrees()
  let totalSize = 0
  for (const w of cleanable) {
    totalSize += await getDirSize(w.path)
  }
  return { count: cleanable.length, totalSize }
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
  const { dbIds, fileIds } = await scanCleanableLogIssueIds()
  const allIds = [...new Set([...dbIds, ...fileIds])]
  if (allIds.length === 0) return { cleaned: 0 }

  // Clean DB records
  const BATCH = 500
  for (let i = 0; i < dbIds.length; i += BATCH) {
    const batch = dbIds.slice(i, i + BATCH)
    await db.delete(issuesLogsToolsCall).where(inArray(issuesLogsToolsCall.issueId, batch))
    await db.delete(attachments).where(inArray(attachments.issueId, batch))
    await db.delete(issueLogs).where(inArray(issueLogs.issueId, batch))
  }

  // Clean log files from disk
  for (const id of fileIds) {
    await rm(join(ISSUE_LOG_DIR, id), { recursive: true }).catch(() => {})
  }

  if (dbIds.length > 0) db.run(sql`VACUUM`)
  logger.info({ cleaned: allIds.length, dbIds: dbIds.length, fileIds: fileIds.length }, 'cleanup_logs_done')
  return { cleaned: allIds.length }
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
  const cleanable = await scanCleanableWorktrees()
  let cleaned = 0

  const projectDirs = new Set<string>()
  for (const w of cleanable) {
    projectDirs.add(w.projectDir)
    try {
      await removeWorktree(process.cwd(), w.path)
      cleaned++
    } catch {
      await rm(w.path, { recursive: true }).catch(() => {})
      cleaned++
    }
  }

  // Remove empty project directories
  for (const projectDir of projectDirs) {
    const remaining = await readdir(projectDir).catch(() => ['_'])
    if (remaining.length === 0) {
      await rm(projectDir, { recursive: true }).catch(() => {})
    }
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
  const issueIds = deletedIssues.map(i => i.id)
  for (let i = 0; i < issueIds.length; i += BATCH) {
    const batch = issueIds.slice(i, i + BATCH)
    // Delete related data first (FK order)
    await db.delete(issuesLogsToolsCall).where(inArray(issuesLogsToolsCall.issueId, batch))
    await db.delete(attachments).where(inArray(attachments.issueId, batch))
    await db.delete(issueLogs).where(inArray(issueLogs.issueId, batch))
    await db.delete(issuesTable).where(inArray(issuesTable.id, batch))
    cleaned += batch.length
  }

  // Hard-delete soft-deleted projects
  const projectIds = deletedProjects.map(p => p.id)
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
