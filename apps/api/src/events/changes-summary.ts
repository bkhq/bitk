import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCommand } from '@/engines/spawn'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { countTextLines, isPathInsideRoot, resolveIssueDir } from '@/utils/changes'

export type { ChangesSummary } from '@bkd/shared'

// --- Git helpers ---

async function runGit(args: string[], cwd: string): Promise<{ code: number, stdout: string }> {
  return runCommand(['git', ...args], { cwd, timeout: 10_000 })
}

/** Parse `git diff --numstat` output. Binary files emit `-\t-` which NaN-guards skip. */
function parseNumstat(stdout: string): { additions: number, deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [a, d] = line.split('\t')
    const add = Number(a)
    const del = Number(d)
    if (!Number.isNaN(add)) additions += add
    if (!Number.isNaN(del)) deletions += del
  }
  return { additions, deletions }
}

async function computeAndEmit(issueId: string): Promise<void> {
  try {
    const [issue] = await db
      .select({
        projectId: issuesTable.projectId,
        useWorktree: issuesTable.useWorktree,
      })
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))

    if (!issue) return

    const project = await findProject(issue.projectId)
    if (!project) return

    const projectRoot = project.directory ? resolve(project.directory) : process.cwd()
    try {
      const s = await stat(projectRoot)
      if (!s.isDirectory()) return
    } catch {
      return
    }

    // Resolve worktree path if applicable
    const root = await resolveIssueDir(issue.projectId, issueId, issue.useWorktree, projectRoot)

    // Check git repo
    const gitCheck = await runGit(['rev-parse', '--is-inside-work-tree'], root)
    if (gitCheck.code !== 0 || gitCheck.stdout.trim() !== 'true') {
      appEvents.emit('changes-summary', {
        issueId,
        fileCount: 0,
        additions: 0,
        deletions: 0,
      })
      return
    }

    // Count changed files (working tree + staged)
    const statusLines: { path: string, isUntracked: boolean }[] = []

    const { code: statusCode, stdout: statusOut } = await runGit(['status', '--porcelain=v1', '-uall'], root)
    if (statusCode === 0) {
      for (const raw of statusOut.split('\n')) {
        const line = raw.trimEnd()
        if (!line || line.length < 3) continue
        const xy = line.slice(0, 2)
        const path = line.slice(3).trim().split(' -> ').at(-1)?.trim() ?? ''
        if (path) {
          statusLines.push({ path, isUntracked: xy === '??' })
        }
      }
    }

    const fileCount = statusLines.length

    // Additions/deletions: combine unstaged + staged numstat, plus count
    // lines in untracked files (git diff ignores them entirely)
    let additions = 0
    let deletions = 0

    if (fileCount > 0) {
      // Single diff against HEAD covers both staged and unstaged changes,
      // avoiding double-counting partially staged hunks and handling renames correctly
      const headDiff = await runGit(['diff', 'HEAD', '-M', '--numstat'], root)
      if (headDiff.code === 0) {
        const stats = parseNumstat(headDiff.stdout)
        additions += stats.additions
        deletions += stats.deletions
      }

      // Untracked files — count lines manually (git diff HEAD ignores them).
      // `-uall` ensures individual files are listed, but guard against
      // directory entries and binary/unreadable files defensively.
      for (const { path, isUntracked } of statusLines) {
        if (!isUntracked) continue
        if (!isPathInsideRoot(root, path)) continue
        try {
          const fullPath = resolve(root, path)
          const s = await stat(fullPath)
          if (!s.isFile()) continue
          const content = await Bun.file(fullPath).text()
          additions += countTextLines(content)
        } catch {
          // skip unreadable files
        }
      }
    }

    appEvents.emit('changes-summary', {
      issueId,
      fileCount,
      additions,
      deletions,
    })
  } catch (err) {
    logger.error({ err, issueId }, 'changes_summary_compute_error')
  }
}

// --- Subscribe to engine events ---

let unsubscribeDone: (() => void) | null = null

export function startChangesSummaryWatcher(): void {
  // Only compute when session settles (completed/failed/cancelled)
  unsubscribeDone = appEvents.on('done', (data) => {
    void computeAndEmit(data.issueId)
  })

  logger.debug('changes_summary_watcher_started')
}

export function stopChangesSummaryWatcher(): void {
  if (unsubscribeDone) {
    unsubscribeDone()
    unsubscribeDone = null
    logger.debug('changes_summary_watcher_stopped')
  }
}
