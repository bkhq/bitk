import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '.'
import { issueLogs } from './schema'

/**
 * Retrieve all pending user messages for a given issue.
 * A pending message is a user-message log entry with metadata.pending === true.
 */
export async function getPendingMessages(issueId: string) {
  const rows = await db
    .select()
    .from(issueLogs)
    .where(
      and(
        eq(issueLogs.issueId, issueId),
        eq(issueLogs.entryType, 'user-message'),
        isNotNull(issueLogs.metadata),
      ),
    )
    .orderBy(asc(issueLogs.turnIndex), asc(issueLogs.entryIndex))
  return rows.filter((row) => {
    try {
      return JSON.parse(row.metadata!).pending === true
    } catch {
      return false
    }
  })
}

/**
 * Mark pending messages as dispatched by setting metadata.pending = false.
 * Only call AFTER the engine has successfully consumed the messages
 * to prevent message loss on failure.
 */
export async function markPendingMessagesDispatched(ids: string[]) {
  if (ids.length === 0) return
  const rows = await db
    .select({ id: issueLogs.id, metadata: issueLogs.metadata })
    .from(issueLogs)
    .where(inArray(issueLogs.id, ids))
  await db.transaction(async (tx) => {
    for (const row of rows) {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = row.metadata ? JSON.parse(row.metadata) : {}
      } catch {
        // If metadata is malformed, start fresh
      }
      parsed.pending = false
      await tx
        .update(issueLogs)
        .set({ metadata: JSON.stringify(parsed) })
        .where(eq(issueLogs.id, row.id))
    }
  })
}
