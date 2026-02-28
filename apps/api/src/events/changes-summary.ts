import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'

export interface ChangesSummary {
  issueId: string
  fileCount: number
  additions: number
  deletions: number
}

type ChangesSummaryCallback = (summary: ChangesSummary) => void

const listeners = new Set<ChangesSummaryCallback>()

export function onChangesSummary(cb: ChangesSummaryCallback): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function emit(summary: ChangesSummary): void {
  for (const cb of listeners) {
    try {
      cb(summary)
    } catch {
      /* ignore */
    }
  }
}

// --- Git helpers ---

async function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const stdout = await new Response(proc.stdout).text()
  const code = await proc.exited
  return { code, stdout }
}

async function computeAndEmit(issueId: string): Promise<void> {
  try {
    const [issue] = await db
      .select({
        projectId: issuesTable.projectId,
        baseCommitHash: issuesTable.baseCommitHash,
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
    } catch {
      return
    }

    // Check git repo
    const gitCheck = await runGit(['rev-parse', '--is-inside-work-tree'], root)
    if (gitCheck.code !== 0 || gitCheck.stdout.trim() !== 'true') {
      emit({ issueId, fileCount: 0, additions: 0, deletions: 0 })
      return
    }

    const baseRef = issue.baseCommitHash ?? 'HEAD'

    // Count changed files
    let filePaths: string[] = []

    if (baseRef === 'HEAD') {
      const { code, stdout } = await runGit(['status', '--porcelain=v1'], root)
      if (code === 0) {
        const lines = stdout
          .split('\n')
          .map((l) => l.trimEnd())
          .filter(Boolean)
        filePaths = lines.map((line) => line.slice(3).trim().split(' -> ').at(-1)?.trim() ?? '')
      }
    } else {
      const { code, stdout } = await runGit(['diff', '--name-only', baseRef], root)
      if (code === 0) {
        filePaths = stdout.split('\n').filter(Boolean)
      }
      const ls = await runGit(['ls-files', '--others', '--exclude-standard'], root)
      if (ls.code === 0) {
        filePaths.push(
          ...ls.stdout
            .split('\n')
            .filter(Boolean)
            .map((l) => l.trim()),
        )
      }
    }

    const fileCount = filePaths.length

    // Additions/deletions via numstat
    let additions = 0
    let deletions = 0

    if (fileCount > 0) {
      const numstatArgs =
        baseRef === 'HEAD' ? ['diff', '--numstat'] : ['diff', '--numstat', baseRef]
      const { code, stdout } = await runGit(numstatArgs, root)
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

    emit({ issueId, fileCount, additions, deletions })
  } catch (err) {
    logger.error({ err, issueId }, 'changes_summary_compute_error')
  }
}

// --- Subscribe to engine events ---

export function startChangesSummaryWatcher(): void {
  // Only compute when session settles (completed/failed/cancelled)
  issueEngine.onIssueSettled((issueId) => {
    void computeAndEmit(issueId)
  })

  logger.debug('changes_summary_watcher_started')
}
