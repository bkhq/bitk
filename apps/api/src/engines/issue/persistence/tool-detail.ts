import type { NormalizedLogEntry, ToolAction, ToolDetail } from '@/engines/types'
import { ulid } from 'ulid'
import { db } from '@/db'
import { issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { logger } from '@/logger'

/** Persist tool detail row linked to a log entry. */
export function persistToolDetail(
  logId: string,
  issueId: string,
  entry: NormalizedLogEntry,
): string | null {
  try {
    const toolName
      = typeof entry.metadata?.toolName === 'string'
        ? entry.metadata.toolName
        : (entry.toolAction?.kind ?? 'unknown')
    const toolCallId
      = typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : null
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
  const toolName
    = typeof entry.metadata?.toolName === 'string'
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
