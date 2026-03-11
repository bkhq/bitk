import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCommand } from '@/engines/spawn'
import { Hono } from 'hono'
import { findProject } from '@/db/helpers'
import { countTextLines, isPathInsideRoot, resolveIssueDir } from '@/utils/changes'
import { isGitRepo } from '@/utils/git'
import { getProjectOwnedIssue } from './_shared'

// ---------- Types ----------

type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'

interface GitChangedFile {
  path: string
  status: string
  type: ChangeType
  staged: boolean
  unstaged: boolean
  previousPath?: string
  additions?: number
  deletions?: number
}

// ---------- Git helpers ----------

async function resolveProjectDir(projectId: string): Promise<string | null> {
  const project = await findProject(projectId)
  if (!project?.directory) return null
  const root = resolve(project.directory)
  try {
    const s = await stat(root)
    if (!s.isDirectory()) return null
  } catch {
    return null
  }
  return root
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number, stdout: string }> {
  return runCommand(['git', ...args], { cwd })
}

function parsePorcelainLine(line: string): GitChangedFile | null {
  if (line.length < 3) return null
  const x = line[0]
  const y = line[1]
  const status = `${x}${y}`
  const rest = line.slice(3).trim()
  const hasRenameArrow = rest.includes(' -> ')
  const previousPath = hasRenameArrow ? rest.split(' -> ')[0]?.trim() : undefined
  const path = hasRenameArrow ? rest.split(' -> ').at(-1)?.trim() || rest : rest
  if (!path) return null

  let type: ChangeType = 'unknown'
  if (status === '??') type = 'untracked'
  else if (x === 'R' || y === 'R') type = 'renamed'
  else if (x === 'A' || y === 'A') type = 'added'
  else if (x === 'D' || y === 'D') type = 'deleted'
  else if (x === 'M' || y === 'M') type = 'modified'

  const staged = x !== ' ' && x !== '?'
  const unstaged = y !== ' ' && y !== '?'
  return { path, status, type, staged, unstaged, previousPath }
}

async function listChangedFiles(cwd: string): Promise<GitChangedFile[]> {
  const { code, stdout } = await runGit(['status', '--porcelain=v1', '-uall'], cwd)
  if (code !== 0) return []
  return stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(parsePorcelainLine)
    .filter((f): f is GitChangedFile => !!f)
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function summarizeFileLines(
  cwd: string,
  file: GitChangedFile,
): Promise<{ additions: number, deletions: number }> {
  if (file.type === 'untracked') {
    if (!isPathInsideRoot(cwd, file.path)) return { additions: 0, deletions: 0 }
    try {
      const content = await Bun.file(resolve(cwd, file.path)).text()
      return { additions: countTextLines(content), deletions: 0 }
    } catch {
      return { additions: 0, deletions: 0 }
    }
  }

  // Combine unstaged + staged stats for this file
  let additions = 0
  let deletions = 0

  for (const extraArgs of [[], ['--cached']]) {
    try {
      const { code, stdout } = await runGit(
        ['diff', ...extraArgs, '--numstat', '--no-color', '--no-ext-diff', '--', file.path],
        cwd,
      )
      if (code !== 0) continue

      const firstLine = stdout
        .split('\n')
        .map(line => line.trim())
        .find(Boolean)
      if (!firstLine) continue

      const [addRaw, delRaw] = firstLine.split('\t')
      if (!Number.isNaN(Number(addRaw))) additions += Number(addRaw)
      if (!Number.isNaN(Number(delRaw))) deletions += Number(delRaw)
    } catch {
      // continue to next variant
    }
  }

  return { additions, deletions }
}

// ---------- Routes ----------

const changes = new Hono()

// GET /api/projects/:projectId/issues/:id/changes — Get changed files from git workspace
changes.get('/:id/changes', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404)

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    return c.json({ success: false, error: 'Project directory is not configured' }, 400)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)
  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true,
      data: { root, gitRepo: false, files: [], additions: 0, deletions: 0 },
    })
  }

  const files = await listChangedFiles(root)

  const filesWithStats = await Promise.all(
    files.map(async file => ({
      ...file,
      ...(await summarizeFileLines(root, file)),
    })),
  )
  const additions = filesWithStats.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = filesWithStats.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return c.json({
    success: true,
    data: { root, gitRepo: true, files: filesWithStats, additions, deletions },
  })
})

// GET /api/projects/:projectId/issues/:id/changes/file?path=... — Get file patch from workspace
changes.get('/:id/changes/file', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404)

  const path = c.req.query('path')?.trim()
  if (!path) return c.json({ success: false, error: 'Missing path' }, 400)

  // SEC-019: Validate path against injection
  if (path.startsWith('-')) {
    return c.json({ success: false, error: 'Invalid path: must not start with -' }, 400)
  }
  if (path.includes(':')) {
    return c.json({ success: false, error: 'Invalid path: must not contain :' }, 400)
  }

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    return c.json({ success: false, error: 'Project directory is not configured' }, 400)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)

  // SEC-019: Validate path is inside working directory on ALL code paths
  if (!isPathInsideRoot(root, path)) {
    return c.json({ success: false, error: 'Invalid path' }, 400)
  }

  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true,
      data: { path, patch: '', truncated: false },
    })
  }

  const changedFiles = await listChangedFiles(root)
  const file = changedFiles.find(f => f.path === path)
  if (!file) {
    return c.json({
      success: true,
      data: { path, patch: '', truncated: false },
    })
  }

  let patch = ''
  let oldText = ''
  let newText = ''
  if (file.type === 'untracked') {
    const abs = resolve(root, path)

    // Use git's own no-index diff output for new files to keep hunk/line
    // numbering and file headers fully compatible with diff renderers.
    const untrackedDiff = await runGit(
      ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
      root,
    )
    patch = untrackedDiff.stdout

    const content = await Bun.file(abs).text()
    oldText = ''
    newText = content
  } else {
    // Try unstaged diff first; fall back to staged diff if empty (fully staged files)
    const unstaged = await runGit(['diff', '--no-color', '--no-ext-diff', '--', path], root)
    patch = unstaged.stdout
    if (!patch.trim()) {
      const staged = await runGit(['diff', '--cached', '--no-color', '--no-ext-diff', '--', path], root)
      patch = staged.stdout
    }

    const oldPath = file.previousPath ?? path
    // SEC-019: Validate previousPath too
    if (oldPath.startsWith('-') || oldPath.includes(':')) {
      return c.json({ success: false, error: 'Invalid path' }, 400)
    }
    if (!isPathInsideRoot(root, oldPath)) {
      return c.json({ success: false, error: 'Invalid path' }, 400)
    }
    const oldShow = await runGit(['show', `HEAD:${oldPath}`], root)
    if (oldShow.code === 0) {
      oldText = oldShow.stdout
    }

    if (file.type !== 'deleted') {
      const abs = resolve(root, path)
      try {
        newText = await Bun.file(abs).text()
      } catch {
        newText = ''
      }
    }
  }

  const maxChars = 200_000
  const truncated = patch.length > maxChars
  if (truncated) patch = `${patch.slice(0, maxChars)}\n\n... [truncated]`

  return c.json({
    success: true,
    data: {
      path,
      patch,
      oldText:
        oldText.length > maxChars ? `${oldText.slice(0, maxChars)}\n... [truncated]` : oldText,
      newText:
        newText.length > maxChars ? `${newText.slice(0, maxChars)}\n... [truncated]` : newText,
      truncated,
      type: file.type,
      status: file.status,
    },
  })
})

export default changes
