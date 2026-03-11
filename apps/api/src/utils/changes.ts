import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { resolveWorktreePath } from '@/engines/issue/utils/worktree'

/**
 * Returns true when `path` (relative to `root`) resolves inside the `root` directory.
 * Prevents path-traversal reads outside the git working tree.
 */
export function isPathInsideRoot(root: string, path: string): boolean {
  const abs = resolve(root, path)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  return abs === root || abs.startsWith(rootPrefix)
}

/**
 * Count non-empty lines in a text string, normalising CRLF.
 */
export function countTextLines(content: string): number {
  if (!content) return 0
  const normalized = content.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n').length : 0
}

/**
 * Resolve the correct working directory for an issue, respecting worktrees.
 * Falls back to `projectRoot` when the worktree directory doesn't exist.
 */
export async function resolveIssueDir(
  projectId: string,
  issueId: string,
  useWorktree: boolean,
  projectRoot: string,
): Promise<string> {
  if (!useWorktree) return projectRoot
  const wtPath = resolveWorktreePath(projectId, issueId)
  try {
    const s = await stat(wtPath)
    if (s.isDirectory()) return wtPath
  } catch {
    // worktree dir doesn't exist — fall back
  }
  return projectRoot
}
