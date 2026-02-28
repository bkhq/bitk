import type { NormalizedLogEntry } from '@/engines/types'
import { and, asc, desc, eq, gt, inArray, lt, max, or } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import { isVisibleForMode } from '@/engines/issue/utils/visibility'
import { rawToToolAction } from './tool-detail'

/** Fetch logs from DB with tool detail join. */
export function getLogsFromDb(
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: { turnIndex: number; entryIndex: number }
    before?: { turnIndex: number; entryIndex: number }
    limit?: number
  },
): NormalizedLogEntry[] {
  // visible=1 filter preserves pending-message dedup (dispatched entries set visible=0).
  // Non-devMode also pre-filters by entryType for performance (avoids loading tool-use rows).
  const conditions = [eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)]
  if (!devMode) {
    conditions.push(
      inArray(logsTable.entryType, ['user-message', 'assistant-message', 'system-message']),
    )
  }

  // Reverse mode: fetch from end (latest) or before a cursor point.
  // Forward mode (cursor): fetch after a cursor point (existing behaviour).
  const isReverse = !opts?.cursor

  if (opts?.cursor) {
    // Forward: rows strictly after (turnIndex, entryIndex)
    conditions.push(
      or(
        gt(logsTable.turnIndex, opts.cursor.turnIndex),
        and(
          eq(logsTable.turnIndex, opts.cursor.turnIndex),
          gt(logsTable.entryIndex, opts.cursor.entryIndex),
        ),
      )!,
    )
  } else if (opts?.before) {
    // Reverse: rows strictly before (turnIndex, entryIndex)
    conditions.push(
      or(
        lt(logsTable.turnIndex, opts.before.turnIndex),
        and(
          eq(logsTable.turnIndex, opts.before.turnIndex),
          lt(logsTable.entryIndex, opts.before.entryIndex),
        ),
      )!,
    )
  }
  // else: no cursor → fetch from end (latest)

  const effectiveLimit = opts?.limit ?? MAX_LOG_ENTRIES
  const rows = db
    .select()
    .from(logsTable)
    .where(and(...conditions))
    .orderBy(
      isReverse ? desc(logsTable.turnIndex) : asc(logsTable.turnIndex),
      isReverse ? desc(logsTable.entryIndex) : asc(logsTable.entryIndex),
    )
    .limit(effectiveLimit)
    .all()

  // Reverse results so output is always in ascending (chronological) order
  if (isReverse) rows.reverse()

  // Batch-fetch tool details for this issue (bounded by log count)
  const toolRows = db
    .select()
    .from(toolsTable)
    .where(eq(toolsTable.issueId, issueId))
    .limit(MAX_LOG_ENTRIES)
    .all()
  const toolByLogId = new Map(toolRows.map((r) => [r.logId, r]))

  const includeCursorMeta = !!opts
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
        metadata: includeCursorMeta
          ? { ...parsedMeta, _cursorEntryIndex: row.entryIndex }
          : parsedMeta,
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
