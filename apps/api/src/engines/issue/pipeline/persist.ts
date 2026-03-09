import type { AppEventMap } from '@bkd/shared'
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
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return

      const isToolUse = data.entry.entryType === 'tool-use'
      // For tool-use entries, metadata goes to the tools table only;
      // content is stored in both tables so it survives page reload without truncation.
      const dbEntry = isToolUse ? { ...data.entry, metadata: undefined } : data.entry

      const persisted = persistEntry(ctx, data.issueId, data.executionId, dbEntry)

      if (persisted) {
        if (isToolUse && persisted.messageId) {
          const detail = buildToolDetail(data.entry)
          if (detail) persisted.toolDetail = detail
          // Restore content/metadata for live clients
          persisted.content = data.entry.content
          persisted.metadata = data.entry.metadata
          // Wrap tool detail insert + log backfill in a single transaction
          // to keep toolCallRefId consistent with the tool record
          db.transaction((tx) => {
            const toolRecordId = persistToolDetail(persisted.messageId!, data.issueId, data.entry)
            if (toolRecordId) {
              tx.update(logsTable)
                .set({ toolCallRefId: toolRecordId })
                .where(eq(logsTable.id, persisted.messageId!))
                .run()
            }
          })
        }
        // Replace entry so downstream stages see messageId (avoid mutating original)
        data.entry = { ...data.entry, ...persisted }
      }
      // DB failure does NOT block ring buffer (order 20) or SSE (order 100)
    },
    { order: 10 },
  )
}
