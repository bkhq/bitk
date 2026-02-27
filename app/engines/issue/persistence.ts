import type { NormalizedLogEntry, ToolAction, ToolDetail } from '../types'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '../../db'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '../../db/schema'
import { logger } from '../../logger'
import { isVisibleForMode } from './helpers'
import { MAX_LOG_ENTRIES } from './types'

/** Persist a single log entry to DB with explicit counter and turn values. */
export function persistLogEntry(
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
  entryIndex: number,
  turnIndex: number,
  replyToMessageId: string | null,
): NormalizedLogEntry | null {
  try {
    const messageId = entry.messageId ?? ulid()

    db.insert(logsTable)
      .values({
        id: messageId,
        issueId,
        turnIndex,
        entryIndex,
        entryType: entry.entryType,
        content: entry.content.trim(),
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        replyToMessageId,
        timestamp: entry.timestamp ?? null,
        visible: 1,
      })
      .run()

    // Return new object — do NOT mutate the input entry
    return {
      ...entry,
      messageId,
      replyToMessageId: replyToMessageId ?? undefined,
    }
  } catch (error) {
    logger.warn({ err: error, issueId }, 'persistLogEntry failed')
    return null
  }
}

/** Persist tool detail row linked to a log entry. */
export function persistToolDetail(
  logId: string,
  issueId: string,
  entry: NormalizedLogEntry,
): string | null {
  try {
    const toolName =
      typeof entry.metadata?.toolName === 'string'
        ? entry.metadata.toolName
        : (entry.toolAction?.kind ?? 'unknown')
    const toolCallId =
      typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : null
    const isResult = entry.metadata?.isResult === true
    const action = entry.toolAction
    const kind = action?.kind ?? 'other'

    // Build raw JSON from all available data
    const rawData: Record<string, unknown> = {
      toolName,
      toolCallId,
      kind,
      isResult,
    }
    if (action) rawData.toolAction = action
    if (entry.metadata) rawData.metadata = entry.metadata
    if (entry.content) {
      const content = entry.content
      rawData.content = content.length > 5000 ? `${content.slice(0, 5000)}...[truncated]` : content
    }

    const toolRecordId = ulid()

    db.insert(toolsTable)
      .values({
        id: toolRecordId,
        logId,
        issueId,
        toolName,
        toolCallId,
        kind,
        isResult,
        raw: JSON.stringify(rawData),
      })
      .run()

    return toolRecordId
  } catch (error) {
    logger.warn({ err: error, logId, issueId }, 'persistToolDetail failed')
    return null
  }
}

/** Build a ToolDetail from an entry (pure function, no DB). */
export function buildToolDetail(entry: NormalizedLogEntry): ToolDetail | null {
  if (entry.entryType !== 'tool-use') return null
  const toolName =
    typeof entry.metadata?.toolName === 'string'
      ? entry.metadata.toolName
      : (entry.toolAction?.kind ?? 'unknown')
  const action = entry.toolAction
  const kind = action?.kind ?? 'other'
  const isResult = entry.metadata?.isResult === true

  return {
    kind,
    toolName,
    toolCallId:
      typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : undefined,
    isResult,
  }
}

/** Reconstruct ToolAction from stored raw JSON. */
export function rawToToolAction(kind: string, rawData: Record<string, unknown>): ToolAction {
  const action = rawData.toolAction as Record<string, unknown> | undefined
  switch (kind) {
    case 'file-read':
      return { kind: 'file-read', path: (action?.path as string) ?? '' }
    case 'file-edit':
      return { kind: 'file-edit', path: (action?.path as string) ?? '' }
    case 'command-run':
      return { kind: 'command-run', command: (action?.command as string) ?? '' }
    case 'search':
      return { kind: 'search', query: (action?.query as string) ?? '' }
    case 'web-fetch':
      return { kind: 'web-fetch', url: (action?.url as string) ?? '' }
    case 'tool':
      return {
        kind: 'tool',
        toolName: (action?.toolName as string) ?? (rawData.toolName as string) ?? '',
      }
    default:
      return { kind: 'other', description: (rawData.toolName as string) ?? kind }
  }
}

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
