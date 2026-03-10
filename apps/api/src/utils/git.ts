import { cacheGetOrSet } from '@/cache'
import { runCommand } from '@/engines/spawn'

async function checkGitWorkTree(cwd: string): Promise<boolean> {
  const { code, stdout } = await runCommand(
    ['git', 'rev-parse', '--is-inside-work-tree'],
    { cwd },
  )
  return code === 0 && stdout.trim() === 'true'
}

/**
 * Check whether `cwd` is inside a git work tree.
 * Result is cached for 120 seconds per directory.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  return cacheGetOrSet(`gitRepo:${cwd}`, 120, () => checkGitWorkTree(cwd))
}

/**
 * Same check without caching — always runs `git rev-parse`.
 * Use when freshness matters (e.g. project API responses).
 */
export async function isGitRepoFresh(cwd: string): Promise<boolean> {
  return checkGitWorkTree(cwd)
}
