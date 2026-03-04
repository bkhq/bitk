import { and, asc, desc, eq, gt, lt, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  issueLogs as logsTable,
  issuesLogsToolsCall as toolsTable,
} from '@/db/schema'
import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import { isVisibleForMode } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { rawToToolAction } from './tool-detail'

/**
 * Fetch logs from DB with tool detail join.
 *
 * Ordering uses the ULID primary key (`id`) which is lexicographically
 * sortable by creation time — simpler and more reliable than the previous
 * composite `(turnIndex, entryIndex)` ordering which could produce wrong
 * results when entryIndex resets across executions.
 */
export function getLogsFromDb(
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: string // ULID id — fetch entries strictly after this
    before?: string // ULID id — fetch entries strictly before this
    limit?: number
  },
): NormalizedLogEntry[] {
  // visible=1 filter preserves pending-message dedup (dispatched entries set visible=0).
  // Non-devMode pre-filters at SQL level to match isVisibleForMode() rules exactly,
  // so the SQL LIMIT accurately reflects visible entries (fixes hasMore pagination).
  const conditions = [eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)]
  if (!devMode) {
    conditions.push(
      sql`(
        (${logsTable.entryType} = 'user-message'
          AND (json_extract(${logsTable.metadata}, '$.type') IS NULL
               OR json_extract(${logsTable.metadata}, '$.type') != 'system'))
        OR ${logsTable.entryType} = 'assistant-message'
        OR (${logsTable.entryType} = 'system-message'
          AND json_extract(${logsTable.metadata}, '$.subtype') IN ('command_output', 'compact_boundary'))
      )`,
    )
  }

  // Reverse mode: fetch from end (latest) or before a cursor point.
  // Forward mode (cursor): fetch after a cursor point.
  const isReverse = !opts?.cursor

  if (opts?.cursor) {
    // Forward: rows strictly after the cursor id
    conditions.push(gt(logsTable.id, opts.cursor))
  } else if (opts?.before) {
    // Reverse: rows strictly before the cursor id
    conditions.push(lt(logsTable.id, opts.before))
  }
  // else: no cursor → fetch from end (latest)

  const effectiveLimit = opts?.limit ?? MAX_LOG_ENTRIES
  const rows = db
    .select()
    .from(logsTable)
    .where(and(...conditions))
    .orderBy(isReverse ? desc(logsTable.id) : asc(logsTable.id))
    .limit(effectiveLimit)
    .all()

  // Reverse results so output is always in ascending (chronological) order
  if (isReverse) rows.reverse()

  // Batch-fetch tool details only in devMode (non-dev excludes tool-use at SQL level)
  const toolByLogId = new Map<string, (typeof toolsTable)['$inferSelect']>()
  if (devMode) {
    const toolRows = db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.issueId, issueId))
      .limit(MAX_LOG_ENTRIES)
      .all()
    for (const r of toolRows) toolByLogId.set(r.logId, r)
  }

  return rows
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
