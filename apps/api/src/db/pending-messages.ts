import { resolve } from 'node:path'
import { and, asc, eq, inArray, isNotNull, max } from 'drizzle-orm'
import { UPLOAD_DIR } from '@/uploads'
import { db } from '.'
import { attachments as attachmentsTable, issueLogs } from './schema'

/**
 * Retrieve the single pending user message for a given issue (if any).
 * A pending message is a user-message log entry with metadata.type === 'pending'.
 * After the upsert merge model there should be at most one per issue.
 */
export async function getPendingMessage(issueId: string) {
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
  return (
    rows.find((row) => {
      try {
        return JSON.parse(row.metadata!).type === 'pending'
      } catch {
        return false
      }
    }) ?? null
  )
}

/** @deprecated Use getPendingMessage (returns single). Kept for migration. */
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
 * Upsert a pending message for an issue.
 * If a pending row already exists: append content with \n\n separator, merge metadata.
 * If no pending row exists: insert a new one.
 * Returns the messageId (ULID) of the pending row.
 */
export async function upsertPendingMessage(
  issueId: string,
  content: string,
  metadata: Record<string, unknown> = { type: 'pending' },
): Promise<string> {
  const { ulid } = await import('ulid')
  const existing = await getPendingMessage(issueId)

  if (existing) {
    // Merge content
    const mergedContent = [existing.content, content.trim()].filter(Boolean).join('\n\n')

    // Merge metadata
    let existingMeta: Record<string, unknown> = {}
    try {
      existingMeta = existing.metadata ? JSON.parse(existing.metadata) : {}
    } catch {
      // ignore
    }

    // Merge displayPrompt: append if both have it
    const existingDisplay = existingMeta.displayPrompt as string | undefined
    const newDisplay = metadata.displayPrompt as string | undefined
    const mergedDisplay =
      existingDisplay && newDisplay ?
        `${existingDisplay}\n\n${newDisplay}` :
        newDisplay || existingDisplay

    // Merge attachments arrays
    const existingAttachments = (existingMeta.attachments ?? []) as unknown[]
    const newAttachments = (metadata.attachments ?? []) as unknown[]
    const mergedAttachments = [...existingAttachments, ...newAttachments]

    const mergedMeta: Record<string, unknown> = {
      ...existingMeta,
      ...metadata,
      type: 'pending',
      ...(mergedDisplay ? { displayPrompt: mergedDisplay } : {}),
      ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
    }

    await db
      .update(issueLogs)
      .set({
        content: mergedContent,
        metadata: JSON.stringify(mergedMeta),
      })
      .where(eq(issueLogs.id, existing.id))

    return existing.id
  }

  // Insert new pending row
  const messageId = ulid()
  await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({
        maxEntry: max(issueLogs.entryIndex),
        maxTurn: max(issueLogs.turnIndex),
      })
      .from(issueLogs)
      .where(eq(issueLogs.issueId, issueId))
    const entryIndex = (maxRow?.maxEntry ?? -1) + 1
    const turnIndex = (maxRow?.maxTurn ?? -1) + 1

    const displayPrompt = metadata.displayPrompt as string | undefined
    await tx.insert(issueLogs).values({
      id: messageId,
      issueId,
      turnIndex,
      entryIndex,
      entryType: 'user-message',
      content: (displayPrompt ?? content).trim(),
      metadata: JSON.stringify({ ...metadata, type: 'pending' }),
      timestamp: new Date().toISOString(),
      visible: 1,
    })
  })
  return messageId
}

/**
 * Delete the pending message for an issue (user recall/edit).
 * Returns the deleted row's content, metadata, and attachment info
 * so the frontend can fill the input box.
 */
export async function deletePendingMessage(issueId: string): Promise<{
  id: string
  content: string
  metadata: Record<string, unknown>
  attachments: Array<{
    id: string
    originalName: string
    mimeType: string
    size: number
  }>
} | null> {
  const pending = await getPendingMessage(issueId)
  if (!pending) return null

  let meta: Record<string, unknown> = {}
  try {
    meta = pending.metadata ? JSON.parse(pending.metadata) : {}
  } catch {
    // ignore
  }

  // Fetch attachment records before deletion
  const attachmentRows = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.logId, pending.id))

  // Hard delete the pending row (it was never processed by AI)
  await db.delete(issueLogs).where(eq(issueLogs.id, pending.id))
  // Also delete associated attachments records
  if (attachmentRows.length > 0) {
    await db.delete(attachmentsTable).where(eq(attachmentsTable.logId, pending.id))
  }

  return {
    id: pending.id,
    content: pending.content,
    metadata: meta,
    attachments: attachmentRows.map(a => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
    })),
  }
}

/**
 * Relocate pending messages for AI processing:
 * 1. Atomically mark pending as visible=0 (optimistic lock)
 * 2. Return the content + metadata for caller to create a new entry at current position
 *
 * Returns null if no pending found or already consumed (race with user edit).
 * Caller should use persistUserMessage() to create the new entry, then emit
 * log-removed SSE for the old messageId.
 */
export async function relocatePendingForProcessing(issueId: string): Promise<{
  oldId: string
  prompt: string
  displayPrompt: string | undefined
  metadata: Record<string, unknown>
} | null> {
  const pending = await getPendingMessage(issueId)
  if (!pending) return null

  // Optimistic lock: only hide if still visible
  const result = db
    .update(issueLogs)
    .set({ visible: 0 })
    .where(and(eq(issueLogs.id, pending.id), eq(issueLogs.visible, 1)))
    .run()

  // Check affected rows — if 0, user already recalled this pending
  if (result.changes === 0) return null

  let meta: Record<string, unknown> = {}
  try {
    meta = pending.metadata ? JSON.parse(pending.metadata) : {}
  } catch {
    // ignore
  }

  // Build full prompt with attachment context
  const attachmentCtx = await getAttachmentContextForLogIds([pending.id])
  const fileCtx = attachmentCtx.get(pending.id) ?? ''
  const prompt = (pending.content + fileCtx).trim()

  const { type: _type, ...restMeta } = meta

  return {
    oldId: pending.id,
    prompt,
    displayPrompt: (meta.displayPrompt as string | undefined) ?? pending.content,
    metadata: restMeta,
  }
}

/**
 * Restore a relocated pending message back to visible if dispatch failed.
 * Prevents losing user input when the engine call fails after relocation.
 */
export function restorePendingVisibility(pendingId: string): void {
  db.update(issueLogs)
    .set({ visible: 1 })
    .where(and(eq(issueLogs.id, pendingId), eq(issueLogs.visible, 0)))
    .run()
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
    f => `[Attached file: ${f.originalName} at ${resolve(UPLOAD_DIR, f.storedName)}]`,
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
): Promise<{ prompt: string, pendingIds: string[] }> {
  const pending = await getPendingMessages(issueId)
  if (pending.length === 0) return { prompt: '', pendingIds: [] }
  const attachmentCtx = await getAttachmentContextForLogIds(pending.map(m => m.id))
  const parts = pending.map((m) => {
    const fileCtx = attachmentCtx.get(m.id) ?? ''
    return (m.content + fileCtx).trim()
  })
  return {
    prompt: parts.filter(Boolean).join('\n\n'),
    pendingIds: pending.map(m => m.id),
  }
}
