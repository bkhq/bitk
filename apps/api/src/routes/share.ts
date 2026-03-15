import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { DEFAULT_LOG_PAGE_SIZE, LOG_PAGE_SIZE_KEY } from '@/engines/issue/constants'
import { serializeIssue } from './issues/_shared'

const share = new Hono()

/** Lookup an issue by its share token — returns null if not found or deleted. */
async function findByShareToken(token: string) {
  const [row] = await db
    .select({
      issue: issuesTable,
      projectName: projectsTable.name,
      projectAlias: projectsTable.alias,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(issuesTable.shareToken, token),
        eq(issuesTable.isDeleted, 0),
        eq(projectsTable.isDeleted, 0),
      ),
    )
  return row ?? null
}

// GET /api/share/:token — Get shared issue (public, no auth)
share.get('/:token', async (c) => {
  const token = c.req.param('token')!
  const row = await findByShareToken(token)
  if (!row) {
    return c.json({ success: false, error: 'Shared issue not found' }, 404)
  }

  return c.json({
    success: true,
    data: {
      ...serializeIssue(row.issue),
      projectName: row.projectName,
      projectAlias: row.projectAlias,
    },
  })
})

// GET /api/share/:token/logs — Get shared issue logs (public, no auth)
share.get('/:token/logs', async (c) => {
  const token = c.req.param('token')!
  const row = await findByShareToken(token)
  if (!row) {
    return c.json({ success: false, error: 'Shared issue not found' }, 404)
  }

  const issueId = row.issue.id
  const cursor = c.req.query('cursor') || undefined
  const before = c.req.query('before') || undefined
  const limitParam = c.req.query('limit')

  let limit: number | undefined
  if (limitParam) {
    limit = Math.min(Math.max(Math.floor(Number(limitParam)) || 30, 1), 1000)
  } else {
    const pageSizeRaw = await getAppSetting(LOG_PAGE_SIZE_KEY)
    limit = pageSizeRaw ? Number(pageSizeRaw) || DEFAULT_LOG_PAGE_SIZE : DEFAULT_LOG_PAGE_SIZE
  }

  const result = issueEngine.getLogs(issueId, { cursor, before, limit })
  const isReverse = !cursor
  const cursorEntry = isReverse ? result.entries[0] : result.entries.at(-1)
  const nextCursor = result.hasMore && cursorEntry?.messageId ? cursorEntry.messageId : null

  return c.json({
    success: true,
    data: {
      issue: serializeIssue(row.issue),
      logs: result.entries,
      nextCursor,
      hasMore: result.hasMore,
    },
  })
})

export default share
