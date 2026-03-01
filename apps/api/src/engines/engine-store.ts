import { and, eq } from 'drizzle-orm'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import type { EngineType, SessionStatus } from './types'

// ---------- Row type inference ----------
type IssueRow = typeof issuesTable.$inferSelect

// ---------- Issue session fields ----------

export interface IssueSessionFields {
  engineType: EngineType | null
  sessionStatus: SessionStatus | null
  prompt: string | null
  externalSessionId: string | null
  model: string | null
}

export function getIssueSessionFields(row: IssueRow): IssueSessionFields {
  return {
    engineType: row.engineType as EngineType | null,
    sessionStatus: row.sessionStatus as SessionStatus | null,
    prompt: row.prompt ?? null,
    externalSessionId: row.externalSessionId ?? null,
    model: row.model ?? null,
  }
}

export async function getIssueWithSession(
  issueId: string,
): Promise<(IssueRow & { sessionFields: IssueSessionFields }) | undefined> {
  const [row] = await db
    .select()
    .from(issuesTable)
    .where(and(eq(issuesTable.id, issueId), eq(issuesTable.isDeleted, 0)))
  if (!row) return undefined
  return { ...row, sessionFields: getIssueSessionFields(row) }
}

export async function updateIssueSession(
  issueId: string,
  changes: Partial<{
    engineType: string
    sessionStatus: string
    prompt: string
    externalSessionId: string | null
    model: string
  }>,
): Promise<IssueRow | undefined> {
  const updates: Record<string, unknown> = {}
  if (changes.engineType !== undefined) updates.engineType = changes.engineType
  if (changes.sessionStatus !== undefined)
    updates.sessionStatus = changes.sessionStatus
  if (changes.prompt !== undefined) updates.prompt = changes.prompt
  if (changes.externalSessionId !== undefined)
    updates.externalSessionId = changes.externalSessionId
  if (changes.model !== undefined) updates.model = changes.model

  if (Object.keys(updates).length === 0) {
    const [row] = await db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))
    return row
  }

  const [row] = await db
    .update(issuesTable)
    .set(updates)
    .where(eq(issuesTable.id, issueId))
    .returning()

  // Invalidate the issue cache so subsequent API reads return fresh data
  // (getProjectOwnedIssue uses cacheGetOrSet with a 30s TTL)
  if (row) {
    await cacheDel(`issue:${row.projectId}:${issueId}`)
  }

  return row
}

/**
 * Auto-move an issue to review when AI execution settles.
 * Moves from any status except done (respects user marking issue as done).
 * Already in review is a no-op.
 */
export async function autoMoveToReview(issueId: string): Promise<void> {
  const [row] = await db
    .select({ statusId: issuesTable.statusId })
    .from(issuesTable)
    .where(eq(issuesTable.id, issueId))

  if (!row || row.statusId === 'done' || row.statusId === 'review') return

  const [updated] = await db
    .update(issuesTable)
    .set({ statusId: 'review', statusUpdatedAt: new Date() })
    .where(eq(issuesTable.id, issueId))
    .returning()

  if (updated) {
    await cacheDel(`issue:${updated.projectId}:${issueId}`)
  }

  emitIssueUpdated(issueId, { statusId: 'review' })
  logger.info({ issueId, from: row.statusId }, 'auto_moved_to_review')
}
