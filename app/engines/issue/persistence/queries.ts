import type { NormalizedLogEntry } from '../../types'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { db } from '../../../db'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '../../../db/schema'
import { MAX_LOG_ENTRIES } from '../constants'
import { isVisibleForMode } from '../utils/visibility'
import { rawToToolAction } from './tool-detail'

/** Fetch logs from DB with tool detail join. */
export function getLogsFromDb(issueId: string, devMode = false): NormalizedLogEntry[] {
  // visible=1 filter preserves pending-message dedup (dispatched entries set visible=0).
  // Non-devMode also pre-filters by entryType for performance (avoids loading tool-use rows).
  const conditions = [eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)]
  if (!devMode) {
    conditions.push(
      inArray(logsTable.entryType, ['user-message', 'assistant-message', 'system-message']),
    )
  }
  const rows = db
    .select()
    .from(logsTable)
    .where(and(...conditions))
    .orderBy(asc(logsTable.turnIndex), asc(logsTable.entryIndex))
    .limit(MAX_LOG_ENTRIES)
    .all()

  // Batch-fetch tool details for this issue (bounded by log count)
  const toolRows = db
    .select()
    .from(toolsTable)
    .where(eq(toolsTable.issueId, issueId))
    .limit(MAX_LOG_ENTRIES)
    .all()
  const toolByLogId = new Map(toolRows.map((r) => [r.logId, r]))

  return rows
    .map((row) => {
      const base: NormalizedLogEntry = {
        messageId: row.id,
        replyToMessageId: row.replyToMessageId ?? undefined,
        entryType: row.entryType as NormalizedLogEntry['entryType'],
        content: row.content.trim(),
        turnIndex: row.turnIndex,
        timestamp: row.timestamp ?? undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
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
