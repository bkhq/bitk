import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '.'
import { issueLogs } from './schema'

/**
 * Retrieve all pending user messages for a given issue.
 * A pending message is a user-message log entry with metadata.type === 'pending'.
 */
export async function getPendingMessages(issueId: string) {
  const rows = await db
    .select()
    .from(issueLogs)
    .where(
      and(
        eq(issueLogs.issueId, issueId),
        eq(issueLogs.entryType, 'user-message'),
        eq(issueLogs.visible, 1),
        isNotNull(issueLogs.metadata),
      ),
    )
    .orderBy(asc(issueLogs.turnIndex), asc(issueLogs.entryIndex))
  return rows.filter((row) => {
    try {
      return JSON.parse(row.metadata!).type === 'pending'
    } catch {
      return false
    }
  })
}

/**
 * Mark pending messages as dispatched by setting visible = 0.
 * Only call AFTER the engine has successfully consumed the messages
 * to prevent message loss on failure.
 */
export async function markPendingMessagesDispatched(ids: string[]) {
  if (ids.length === 0) return
  await db.update(issueLogs).set({ visible: 0 }).where(inArray(issueLogs.id, ids))
}
