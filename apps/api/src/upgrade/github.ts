import { logger } from '@/logger'
import { VERSION } from '@/version'
import type { ReleaseInfo } from './types'

/** Fetch the latest release from GitHub API (internal to upgrade module) */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch('https://api.github.com/repos/bkhq/bkd/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': `bkd/${VERSION}`,
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 404) {
      // No releases yet
      return null
    }

    if (!res.ok) {
      logger.warn(
        { status: res.status, statusText: res.statusText },
        'upgrade_fetch_release_failed',
      )
      return null
    }

    const data = (await res.json()) as {
      tag_name: string
      published_at: string
      html_url: string
      assets: Array<{
        name: string
        size: number
        browser_download_url: string
        content_type: string
      }>
    }

    return {
      version: data.tag_name.replace(/^v/, ''),
      tag: data.tag_name,
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      assets: data.assets.map(a => ({
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url,
        contentType: a.content_type,
      })),
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'upgrade_fetch_release_error',
    )
    return null
  }
}
