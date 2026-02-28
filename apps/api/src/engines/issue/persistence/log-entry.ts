import type { NormalizedLogEntry } from '@/engines/types'
import { ulid } from 'ulid'
import { db } from '@/db'
import { issueLogs as logsTable } from '@/db/schema'
import { logger } from '@/logger'

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
