import type { AppEventMap } from '@bitk/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable } from '@/db/schema'
import type { EngineContext } from '../context'
import { persistEntry } from '../persistence/entry'
import { buildToolDetail, persistToolDetail } from '../persistence/tool-detail'

/**
 * Order 10 — DB persistence + messageId enrichment.
 *
 * Persists non-streaming log entries to SQLite. For tool-use entries,
 * content & metadata are stored in the separate tools table.
 * Enriches `data.entry` with the persisted messageId so downstream
 * stages (ring buffer, SSE) see it.
 *
 * Future: this stage may gain a write-ahead buffer or batch queue
 * to amortise DB writes under high throughput.
 */
export function registerPersistStage(
  ctx: EngineContext,
  on: (
    cb: (data: AppEventMap['log']) => void,
    opts: { order: number },
  ) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return

      const isToolUse = data.entry.entryType === 'tool-use'
      // For tool-use entries, content & metadata go to the tools table only
      const dbEntry = isToolUse
        ? { ...data.entry, content: '', metadata: undefined }
        : data.entry

      const persisted = persistEntry(
        ctx,
        data.issueId,
        data.executionId,
        dbEntry,
      )

      if (persisted) {
        if (isToolUse && persisted.messageId) {
          const detail = buildToolDetail(data.entry)
          if (detail) persisted.toolDetail = detail
          // Restore content/metadata for live clients
          persisted.content = data.entry.content
          persisted.metadata = data.entry.metadata
          const toolRecordId = persistToolDetail(
            persisted.messageId,
            data.issueId,
            data.entry,
          )
          if (toolRecordId) {
            db.update(logsTable)
              .set({ toolCallRefId: toolRecordId })
              .where(eq(logsTable.id, persisted.messageId))
              .run()
          }
        }
        // Replace entry so downstream stages see messageId (avoid mutating original)
        data.entry = { ...data.entry, ...persisted }
      }
      // DB failure does NOT block ring buffer (order 20) or SSE (order 100)
    },
    { order: 10 },
  )
}
