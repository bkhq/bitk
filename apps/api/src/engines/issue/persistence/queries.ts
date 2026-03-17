import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import { isVisible } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { rawToToolAction } from './tool-detail'

export interface PaginatedLogResult {
  entries: NormalizedLogEntry[]
  hasMore: boolean
}

export interface LogQueryOpts {
  cursor?: string // ULID id — fetch entries strictly after this
  before?: string // ULID id — fetch entries strictly before this
  limit?: number
  /** Filter by specific entry types. When set, only these types are returned. */
  entryTypes?: string[]
  /** Inclusive lower bound for turnIndex. */
  turnIndex?: number
  /** Inclusive upper bound for turnIndex. */
  turnIndexEnd?: number
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

/** Map a DB row + optional tool detail to a NormalizedLogEntry. */
function rowToEntry(
  row: typeof logsTable.$inferSelect,
  toolByLogId: Map<string, typeof toolsTable.$inferSelect>,
): NormalizedLogEntry {
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
    if (!base.content && rawData.content) {
      base.content = rawData.content as string
    }
    if (!base.metadata && rawData.metadata) {
      base.metadata = rawData.metadata as Record<string, unknown>
    }
  }

  return base
}

/** Batch-fetch tool details for a set of log rows. */
function fetchToolDetails(logIds: string[]): Map<string, typeof toolsTable.$inferSelect> {
  const map = new Map<string, typeof toolsTable.$inferSelect>()
  if (logIds.length === 0) return map
  const toolRows = db.select().from(toolsTable).where(inArray(toolsTable.logId, logIds)).all()
  for (const r of toolRows) map.set(r.logId, r)
  return map
}

/** Build shared conditions for turnIndex range and cursor pagination. */
function applyCommonConditions(conditions: ReturnType<typeof eq>[], opts?: LogQueryOpts): void {
  if (opts?.turnIndex != null) {
    conditions.push(gte(logsTable.turnIndex, opts.turnIndex))
  }
  if (opts?.turnIndexEnd != null) {
    conditions.push(lte(logsTable.turnIndex, opts.turnIndexEnd))
  }
  if (opts?.cursor) conditions.push(gt(logsTable.id, opts.cursor))
  else if (opts?.before) conditions.push(lt(logsTable.id, opts.before))
}

/**
 * Fetch logs from DB with conversation-message-based pagination.
 *
 * When `entryTypes` is provided, pagination and results are both scoped
 * to those types only (simple single-pass query). Otherwise, the default
 * two-step approach is used: pagination counts conversation messages
 * (user + assistant) toward the limit, but returns all visible entries
 * within the range — including tool-use and system messages.
 *
 * Supports optional turnIndex range filtering.
 */
export function getLogsFromDb(
  issueId: string,
  opts?: LogQueryOpts,
): PaginatedLogResult {
  // When entryTypes filter is specified, use the simpler single-pass path
  if (opts?.entryTypes && opts.entryTypes.length > 0) {
    return getFilteredLogsFromDb(issueId, opts)
  }

  const isReverse = !opts?.cursor
  const effectiveLimit = opts?.limit ?? MAX_LOG_ENTRIES

  // --- Step 1: Find conversation message boundaries ---
  const convConditions = [
    eq(logsTable.issueId, issueId),
    eq(logsTable.visible, 1),
    CONVERSATION_MSG_CONDITION,
  ]
  applyCommonConditions(convConditions, opts)

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

  // --- Step 2: Fetch all entries within the boundary range ---
  // DB filters by visible=1 only; isVisible() post-filters by entry type.
  const allConditions = [eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)]

  // Apply turnIndex filters to step 2 as well
  if (opts?.turnIndex != null) {
    allConditions.push(gte(logsTable.turnIndex, opts.turnIndex))
  }
  if (opts?.turnIndexEnd != null) {
    allConditions.push(lte(logsTable.turnIndex, opts.turnIndexEnd))
  }

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

  const toolByLogId = fetchToolDetails(rows.map(r => r.id))
  const entries = rows.map(row => rowToEntry(row, toolByLogId)).filter(isVisible)

  return { entries, hasMore }
}

/**
 * Single-pass query for filtered entry types.
 * Both pagination and results are scoped to the requested types only.
 */
function getFilteredLogsFromDb(
  issueId: string,
  opts: LogQueryOpts,
): PaginatedLogResult {
  const isReverse = !opts.cursor
  const effectiveLimit = opts.limit ?? MAX_LOG_ENTRIES

  const conditions = [
    eq(logsTable.issueId, issueId),
    eq(logsTable.visible, 1),
    inArray(logsTable.entryType, opts.entryTypes!),
  ]
  applyCommonConditions(conditions, opts)

  const rows = db
    .select()
    .from(logsTable)
    .where(and(...conditions))
    .orderBy(isReverse ? desc(logsTable.id) : asc(logsTable.id))
    .limit(effectiveLimit + 1)
    .all()

  const hasMore = rows.length > effectiveLimit
  if (hasMore) rows.pop()

  // Always return in ascending (chronological) order
  if (isReverse) rows.reverse()

  const toolByLogId = fetchToolDetails(rows.map(r => r.id))
  const entries = rows.map(row => rowToEntry(row, toolByLogId)).filter(isVisible)

  return { entries, hasMore }
}

/** Soft-remove a log entry by marking it invisible (idempotent). */
export function removeLogEntry(messageId: string): void {
  db.update(logsTable).set({ visible: 0, isDeleted: 1 }).where(eq(logsTable.id, messageId)).run()
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
