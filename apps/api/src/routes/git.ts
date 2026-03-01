import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import * as z from 'zod'

const detectRemoteSchema = z.object({
  directory: z.string().min(1).max(1000),
})

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ''
  const code = await proc.exited
  return { code, stdout }
}

const git = new Hono()

// POST /api/git/detect-remote — Detect git remote URL from a directory
git.post(
  '/detect-remote',
  zValidator('json', detectRemoteSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map((i) => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { directory } = c.req.valid('json')
    const dir = resolve(directory)

    // Check directory exists
    try {
      const s = await stat(dir)
      if (!s.isDirectory()) {
        return c.json({ success: false, error: 'not_a_directory' }, 400)
      }
    } catch {
      return c.json({ success: false, error: 'directory_not_found' }, 404)
    }

    // Check if it's a git repo
    const revParse = await runGit(['rev-parse', '--is-inside-work-tree'], dir)
    if (revParse.code !== 0 || revParse.stdout.trim() !== 'true') {
      return c.json({ success: false, error: 'not_a_git_repo' }, 400)
    }

    // Try to get remote URL — prefer 'origin', fall back to first remote
    const originUrl = await runGit(['remote', 'get-url', 'origin'], dir)
    if (originUrl.code === 0 && originUrl.stdout.trim()) {
      const url = normalizeGitUrl(originUrl.stdout.trim())
      return c.json({ success: true, data: { url, remote: 'origin' } })
    }

    // List all remotes and try the first one
    const remoteList = await runGit(['remote'], dir)
    if (remoteList.code === 0 && remoteList.stdout.trim()) {
      const firstRemote = remoteList.stdout.trim().split('\n')[0]
      if (firstRemote) {
        const remoteUrl = await runGit(['remote', 'get-url', firstRemote], dir)
        if (remoteUrl.code === 0 && remoteUrl.stdout.trim()) {
          const url = normalizeGitUrl(remoteUrl.stdout.trim())
          return c.json({
            success: true,
            data: { url, remote: firstRemote },
          })
        }
      }
    }

    return c.json({ success: false, error: 'no_remote_found' }, 404)
  },
)

/** Convert SSH git URLs to HTTPS format for browser use */
function normalizeGitUrl(url: string): string {
  // git@github.com:org/repo.git → https://github.com/org/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`
  }
  // Remove trailing .git from HTTPS URLs
  return url.replace(/\.git$/, '')
}

export default git
