import { and, asc, desc, eq, gt, inArray, lt, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  issueLogs as logsTable,
  issuesLogsToolsCall as toolsTable,
} from '@/db/schema'
import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import { isVisibleForMode } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { rawToToolAction } from './tool-detail'

export interface PaginatedLogResult {
  entries: NormalizedLogEntry[]
  hasMore: boolean
}

/** Safety cap: max total entries returned per page (prevents extreme tool-use fan-out). */
const MAX_PAGE_ENTRIES = 2000

/**
 * SQL condition that matches only "conversation messages":
 * user-message (excluding system meta-turns) and assistant-message.
 * Used as the counting basis for pagination.
 */
const CONVERSATION_MSG_CONDITION = sql`(
  (${logsTable.entryType} = 'user-message'
    AND (json_extract(${logsTable.metadata}, '$.type') IS NULL
         OR json_extract(${logsTable.metadata}, '$.type') != 'system'))
  OR ${logsTable.entryType} = 'assistant-message'
)`

/**
 * SQL condition for all visible entry types in non-devMode.
 * Matches isVisibleForMode() rules: only user and assistant messages.
 */
const VISIBLE_ENTRIES_CONDITION = CONVERSATION_MSG_CONDITION

/**
 * Fetch logs from DB with conversation-message-based pagination.
 *
 * Pagination counts only user-message and assistant-message entries
 * (conversation messages) toward the limit, but returns all visible
 * entries within the range — including tool-use and system messages.
 *
 * Two-step approach:
 * 1. Find conversation message boundary IDs to determine page range + hasMore
 * 2. Fetch all visible entries within the boundary range
 */
export function getLogsFromDb(
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: string // ULID id — fetch entries strictly after this
    before?: string // ULID id — fetch entries strictly before this
    limit?: number
  },
): PaginatedLogResult {
  const isReverse = !opts?.cursor
  const effectiveLimit = opts?.limit ?? MAX_LOG_ENTRIES

  // --- Step 1: Find conversation message boundaries ---
  const convConditions = [
    eq(logsTable.issueId, issueId),
    eq(logsTable.visible, 1),
    CONVERSATION_MSG_CONDITION,
  ]
  if (opts?.cursor) convConditions.push(gt(logsTable.id, opts.cursor))
  else if (opts?.before) convConditions.push(lt(logsTable.id, opts.before))

  const convMessages = db
    .select({ id: logsTable.id })
    .from(logsTable)
    .where(and(...convConditions))
    .orderBy(isReverse ? desc(logsTable.id) : asc(logsTable.id))
    .limit(effectiveLimit + 1)
    .all()

  const hasMore = convMessages.length > effectiveLimit

  // Determine the boundary conversation message ID.
  // For reverse (DESC): the (effectiveLimit-1)th entry is the oldest we keep.
  // For forward (ASC): the (effectiveLimit-1)th entry is the newest we keep.
  let boundaryId: string | null = null
  if (hasMore) {
    boundaryId = convMessages[effectiveLimit - 1].id
  }

  // --- Step 2: Fetch all visible entries within the boundary range ---
  const allConditions = [
    eq(logsTable.issueId, issueId),
    eq(logsTable.visible, 1),
  ]
  if (!devMode) allConditions.push(VISIBLE_ENTRIES_CONDITION)

  if (opts?.cursor) allConditions.push(gt(logsTable.id, opts.cursor))
  else if (opts?.before) allConditions.push(lt(logsTable.id, opts.before))

  if (hasMore && boundaryId) {
    if (isReverse) {
      // Reverse: include entries >= boundaryId (oldest conversation message we keep)
      allConditions.push(sql`${logsTable.id} >= ${boundaryId}`)
    } else {
      // Forward: include entries <= boundaryId (newest conversation message we keep)
      allConditions.push(sql`${logsTable.id} <= ${boundaryId}`)
    }
  }

  const rows = db
    .select()
    .from(logsTable)
    .where(and(...allConditions))
    .orderBy(isReverse ? desc(logsTable.id) : asc(logsTable.id))
    .limit(MAX_PAGE_ENTRIES)
    .all()

  // Always return in ascending (chronological) order
  if (isReverse) rows.reverse()

  // Batch-fetch tool details for any rows that might be tool-use entries
  const toolByLogId = new Map<string, (typeof toolsTable)['$inferSelect']>()
  if (rows.length > 0) {
    const logIds = rows.map((r) => r.id)
    const toolRows = db
      .select()
      .from(toolsTable)
      .where(inArray(toolsTable.logId, logIds))
      .all()
    for (const r of toolRows) toolByLogId.set(r.logId, r)
  }

  const entries = rows
    .map((row) => {
      const parsedMeta = row.metadata ? JSON.parse(row.metadata) : undefined
      const base: NormalizedLogEntry = {
        messageId: row.id,
        replyToMessageId: row.replyToMessageId ?? undefined,
        entryType: row.entryType as NormalizedLogEntry['entryType'],
        content: row.content.trim(),
        turnIndex: row.turnIndex,
        timestamp: row.timestamp ?? undefined,
        metadata: parsedMeta,
      }

      // Attach tool detail and reconstruct toolAction + content/metadata from tools table
      const tool = toolByLogId.get(row.id)
      if (tool) {
        const rawData = tool.raw ? JSON.parse(tool.raw) : {}
        base.toolDetail = {
          kind: tool.kind,
          toolName: tool.toolName,
          toolCallId: tool.toolCallId ?? undefined,
          isResult: tool.isResult ?? false,
          raw: rawData,
        }
        base.toolAction = rawToToolAction(tool.kind, rawData)
        // Restore content & metadata from raw (not stored in issues_logs for tool-use)
        if (!base.content && rawData.content) {
          base.content = rawData.content as string
        }
        if (!base.metadata && rawData.metadata) {
          base.metadata = rawData.metadata as Record<string, unknown>
        }
      }

      return base
    })
    .filter((entry) => isVisibleForMode(entry, devMode))

  return { entries, hasMore }
}

/** Soft-remove a log entry by marking it invisible (idempotent). */
export function removeLogEntry(messageId: string): void {
  db.update(logsTable)
    .set({ visible: 0, isDeleted: 1 })
    .where(eq(logsTable.id, messageId))
    .run()
}

/** Get next turn index from DB for an issue. */
export function getNextTurnIndex(issueId: string): number {
  const [row] = db
    .select({ maxTurn: max(logsTable.turnIndex) })
    .from(logsTable)
    .where(eq(logsTable.issueId, issueId))
    .all()
  return (row?.maxTurn ?? -1) + 1
}
