import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'

export type { ChangesSummary } from '@bkd/shared'

// --- Git helpers ---

async function runGit(args: string[], cwd: string): Promise<{ code: number, stdout: string }> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
    signal: AbortSignal.timeout(10_000),
  })
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ''
  const code = await proc.exited
  return { code, stdout }
}

async function computeAndEmit(issueId: string): Promise<void> {
  try {
    const [issue] = await db
      .select({
        projectId: issuesTable.projectId,
      })
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))

    if (!issue) return

    const project = await findProject(issue.projectId)
    if (!project) return

    const root = project.directory ? resolve(project.directory) : process.cwd()
    try {
      const s = await stat(root)
      if (!s.isDirectory()) return
    }
    catch {
      return
    }

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

    // Count changed files (working tree only)
    let filePaths: string[] = []

    const { code: statusCode, stdout: statusOut } = await runGit(['status', '--porcelain=v1'], root)
    if (statusCode === 0) {
      const lines = statusOut
        .split('\n')
        .map(l => l.trimEnd())
        .filter(Boolean)
      filePaths = lines.map(line => line.slice(3).trim().split(' -> ').at(-1)?.trim() ?? '')
    }

    const fileCount = filePaths.length

    // Additions/deletions via numstat
    let additions = 0
    let deletions = 0

    if (fileCount > 0) {
      const { code, stdout } = await runGit(['diff', '--numstat'], root)
      if (code === 0) {
        for (const line of stdout.split('\n').filter(Boolean)) {
          const [a, d] = line.split('\t')
          const add = Number(a)
          const del = Number(d)
          if (!Number.isNaN(add)) additions += add
          if (!Number.isNaN(del)) deletions += del
        }
      }
    }

    appEvents.emit('changes-summary', {
      issueId,
      fileCount,
      additions,
      deletions,
    })
  }
  catch (err) {
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
