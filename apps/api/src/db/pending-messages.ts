import { resolve } from 'node:path'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { UPLOAD_DIR } from '@/uploads'
import { db } from '.'
import { attachments as attachmentsTable, issueLogs } from './schema'

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
  await db
    .update(issueLogs)
    .set({ visible: 0 })
    .where(inArray(issueLogs.id, ids))
}

/**
 * Promote pending messages: remove the `type: 'pending'` metadata flag so they
 * appear as regular user messages.  The rows stay visible (visible = 1).
 *
 * Use this instead of `markPendingMessagesDispatched` when the engine will NOT
 * persist a new user-message entry for the same content (skipPersistMessage),
 * avoiding duplicate messages in the frontend.
 */
export async function promotePendingMessages(ids: string[]) {
  if (ids.length === 0) return
  // Update each row: parse metadata JSON, remove `type`, write back
  const rows = await db
    .select({ id: issueLogs.id, metadata: issueLogs.metadata })
    .from(issueLogs)
    .where(inArray(issueLogs.id, ids))
  for (const row of rows) {
    let meta: Record<string, unknown> = {}
    try {
      meta = row.metadata ? JSON.parse(row.metadata) : {}
    } catch {
      continue
    }
    const { type: _type, ...rest } = meta
    await db
      .update(issueLogs)
      .set({
        metadata: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
      })
      .where(eq(issueLogs.id, row.id))
  }
}

// ---------- Attachment context ----------

/**
 * Build a file-context prompt supplement from attachment DB rows.
 */
export function buildFileContextFromRows(
  rows: {
    originalName: string
    storedName: string
    mimeType: string
    size: number
  }[],
): string {
  if (rows.length === 0) return ''
  const parts = rows.map(
    (f) =>
      `[Attached file: ${f.originalName} at ${resolve(UPLOAD_DIR, f.storedName)}]`,
  )
  return `\n\n--- Attached files ---\n${parts.join('\n')}`
}

/**
 * Look up attachment records for the given log IDs and return file context
 * grouped by log ID.
 */
export async function getAttachmentContextForLogIds(
  logIds: string[],
): Promise<Map<string, string>> {
  if (logIds.length === 0) return new Map()
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(inArray(attachmentsTable.logId, logIds))
  const byLogId = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.logId) continue
    const existing = byLogId.get(row.logId) ?? []
    existing.push(row)
    byLogId.set(row.logId, existing)
  }
  const result = new Map<string, string>()
  for (const [logId, attachmentRows] of byLogId) {
    result.set(logId, buildFileContextFromRows(attachmentRows))
  }
  return result
}

/**
 * Collect all pending messages for an issue and merge them into a single
 * prompt string, including attachment file context. Returns the merged prompt
 * and the IDs of consumed pending messages.
 */
export async function collectPendingWithAttachments(
  issueId: string,
): Promise<{ prompt: string; pendingIds: string[] }> {
  const pending = await getPendingMessages(issueId)
  if (pending.length === 0) return { prompt: '', pendingIds: [] }
  const attachmentCtx = await getAttachmentContextForLogIds(
    pending.map((m) => m.id),
  )
  const parts = pending.map((m) => {
    const fileCtx = attachmentCtx.get(m.id) ?? ''
    return (m.content + fileCtx).trim()
  })
  return {
    prompt: parts.filter(Boolean).join('\n\n'),
    pendingIds: pending.map((m) => m.id),
  }
}
