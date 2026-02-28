import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Hono } from 'hono'
import { cacheGetOrSet } from '@/cache'
import { findProject } from '@/db/helpers'
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

function isPathInsideRoot(root: string, path: string): boolean {
  const abs = resolve(root, path)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  return abs === root || abs.startsWith(rootPrefix)
}

function countTextLines(content: string): number {
  if (!content) return 0
  const normalized = content.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n').length : 0
}

async function resolveProjectDir(projectId: string): Promise<string> {
  const project = await findProject(projectId)
  const root = project?.directory ? resolve(project.directory) : process.cwd()
  const s = await stat(root)
  if (!s.isDirectory()) throw new Error(`Project directory is not a directory: ${root}`)
  return root
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ''
  const code = await proc.exited
  return { code, stdout, stderr: '' }
}

async function isGitRepo(cwd: string): Promise<boolean> {
  return cacheGetOrSet(`gitRepo:${cwd}`, 120, async () => {
    const { code, stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], cwd)
    return code === 0 && stdout.trim() === 'true'
  })
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
  const { code, stdout } = await runGit(['status', '--porcelain=v1'], cwd)
  if (code !== 0) return []
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parsePorcelainLine)
    .filter((f): f is GitChangedFile => !!f)
    .sort((a, b) => a.path.localeCompare(b.path))
}

async function summarizeFileLines(
  cwd: string,
  file: GitChangedFile,
): Promise<{ additions: number; deletions: number }> {
  if (file.type === 'untracked') {
    if (!isPathInsideRoot(cwd, file.path)) return { additions: 0, deletions: 0 }
    try {
      const content = await Bun.file(resolve(cwd, file.path)).text()
      return { additions: countTextLines(content), deletions: 0 }
    } catch {
      return { additions: 0, deletions: 0 }
    }
  }

  try {
    const { code, stdout } = await runGit(
      ['diff', '--numstat', '--no-color', '--no-ext-diff', '--', file.path],
      cwd,
    )
    if (code !== 0) return { additions: 0, deletions: 0 }

    const firstLine = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    if (!firstLine) return { additions: 0, deletions: 0 }

    const [addRaw, delRaw] = firstLine.split('\t')
    const additions = Number.isNaN(Number(addRaw)) ? 0 : Number(addRaw)
    const deletions = Number.isNaN(Number(delRaw)) ? 0 : Number(delRaw)
    return { additions, deletions }
  } catch {
    return { additions: 0, deletions: 0 }
  }
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

  const root = await resolveProjectDir(project.id)
  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true,
      data: { root, gitRepo: false, files: [], additions: 0, deletions: 0 },
    })
  }

  const files = await listChangedFiles(root)

  const filesWithStats = await Promise.all(
    files.map(async (file) => ({
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

  const root = await resolveProjectDir(project.id)

  // SEC-019: Validate path is inside project root on ALL code paths
  if (!isPathInsideRoot(root, path)) {
    return c.json({ success: false, error: 'Invalid path' }, 400)
  }

  const gitRepo = await isGitRepo(root)
  if (!gitRepo) return c.json({ success: true, data: { path, patch: '', truncated: false } })

  const changedFiles = await listChangedFiles(root)
  const file = changedFiles.find((f) => f.path === path)
  if (!file) {
    return c.json({ success: true, data: { path, patch: '', truncated: false } })
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
    const { stdout } = await runGit(['diff', '--no-color', '--no-ext-diff', '--', path], root)
    patch = stdout

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
