import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupWorktree,
  createWorktree,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { ROOT_DIR } from '@/root'

/**
 * Worktree utility tests — verifies:
 * 1. resolveWorktreePath returns deterministic path under ROOT_DIR/data/worktrees/
 * 2. createWorktree creates a git worktree and returns its path
 * 3. removeWorktree removes the git worktree and cleans up the directory
 * 4. removeWorktree falls back to directory deletion when git command fails
 * 5. cleanupWorktree calls removeWorktree (fire-and-forget)
 *
 * These tests use the actual git repo since worktree operations require it.
 */

let gitRoot = ''
const TEST_PROJECT_ID = `test-project-${Date.now()}`
const issueIds: string[] = []

function makeIssueId(prefix = 'test-wt'): string {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  issueIds.push(id)
  return id
}

beforeAll(() => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-worktree-repo-'))
  Bun.spawnSync(['git', 'init'], { cwd: gitRoot })
  Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], {
    cwd: gitRoot,
  })
  Bun.spawnSync(['git', 'config', 'user.name', 'BitK Test'], { cwd: gitRoot })

  writeFileSync(join(gitRoot, 'README.md'), 'test repo\n')
  Bun.spawnSync(['git', 'add', '.'], { cwd: gitRoot })
  Bun.spawnSync(['git', 'commit', '-m', 'init'], { cwd: gitRoot })
})

afterAll(() => {
  // Clean up any leftover worktrees and branches created by tests
  for (const issueId of issueIds) {
    const wtDir = resolveWorktreePath(TEST_PROJECT_ID, issueId)
    try {
      if (existsSync(wtDir)) {
        Bun.spawnSync(['git', 'worktree', 'remove', '--force', wtDir], {
          cwd: gitRoot,
        })
      }
    }
    catch {
      /* best effort */
    }
    try {
      Bun.spawnSync(['git', 'branch', '-D', `bkd/${issueId}`], {
        cwd: gitRoot,
      })
    }
    catch {
      /* best effort */
    }
  }

  // Clean up the test project directory under data/worktrees/
  try {
    const projectDir = join(ROOT_DIR, 'data/worktrees', TEST_PROJECT_ID)
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true })
    }
  }
  catch {
    /* best effort */
  }

  try {
    if (gitRoot && existsSync(gitRoot)) {
      rmSync(gitRoot, { recursive: true, force: true })
    }
  }
  catch {
    /* best effort */
  }
})

describe('resolveWorktreePath', () => {
  test('returns deterministic path under ROOT_DIR/worktrees/', () => {
    const path = resolveWorktreePath('proj-1', 'issue-abc')
    expect(path).toBe(join(ROOT_DIR, 'worktrees', 'proj-1', 'issue-abc'))
  })
})

describe('createWorktree', () => {
  test('creates a worktree directory with the expected path', async () => {
    const issueId = makeIssueId('create')
    const worktreeDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(worktreeDir).toBe(resolveWorktreePath(TEST_PROJECT_ID, issueId))
    expect(existsSync(worktreeDir)).toBe(true)

    // Verify it's a valid git worktree (has .git file)
    expect(existsSync(join(worktreeDir, '.git'))).toBe(true)
  })

  test('retries with existing branch on second call', async () => {
    const issueId = makeIssueId('retry')
    const firstDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(firstDir)).toBe(true)
    await removeWorktree(gitRoot, firstDir)

    const worktreeDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(worktreeDir)).toBe(true)
  })
})

describe('removeWorktree', () => {
  test('removes worktree via git command', async () => {
    const issueId = makeIssueId('remove')
    const wtDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(wtDir)).toBe(true)

    await removeWorktree(gitRoot, wtDir)
    expect(existsSync(wtDir)).toBe(false)
  })

  test('falls back to directory deletion for non-git worktree dirs', async () => {
    const fakeDir = join(ROOT_DIR, 'worktrees', TEST_PROJECT_ID, 'fake-worktree')
    mkdirSync(fakeDir, { recursive: true })
    writeFileSync(join(fakeDir, 'test.txt'), 'test')
    expect(existsSync(fakeDir)).toBe(true)

    await removeWorktree(gitRoot, fakeDir)
    expect(existsSync(fakeDir)).toBe(false)
  })
})

describe('cleanupWorktree', () => {
  test('calls removeWorktree as fire-and-forget', async () => {
    const cleanupIssueId = makeIssueId('cleanup')
    const wtDir = await createWorktree(gitRoot, TEST_PROJECT_ID, cleanupIssueId)

    expect(existsSync(wtDir)).toBe(true)

    // cleanupWorktree is fire-and-forget — pass baseDir explicitly
    cleanupWorktree(gitRoot, cleanupIssueId, wtDir)

    // Wait for the async cleanup to complete
    await Bun.sleep(1000)

    expect(existsSync(wtDir)).toBe(false)

    // Clean up branch
    Bun.spawnSync(['git', 'branch', '-D', `bkd/${cleanupIssueId}`], {
      cwd: gitRoot,
    })
  })
})
