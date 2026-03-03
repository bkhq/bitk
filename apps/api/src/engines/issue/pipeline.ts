import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable } from '@/db/schema'
import { appEvents } from '@/events'
import type { EngineContext } from './context'
import { persistEntry } from './persistence/entry'
import {
  buildToolDetail,
  persistToolDetail,
} from './persistence/tool-detail'
import { dispatch } from './state'
import { applyAutoTitle } from './title'
import { getIssueDevMode, isVisibleForMode } from './utils/visibility'

// ---------- Pipeline registration ----------

/**
 * Register all log-entry pipeline stages on the global event bus.
 *
 * The pipeline replaces the monolithic handleStreamEntry logic.
 * Each stage is an independent ordered subscriber:
 *   middleware  — devMode visibility filter (runs first, can suppress)
 *   order 10   — DB persistence + messageId enrichment
 *   order 20   — ring buffer push
 *   order 30   — auto-title extraction (meta turns)
 *   order 40   — logical failure detection
 *   order 100  — (reserved for SSE subscribers, registered by routes/events.ts)
 *
 * Stages are isolated: a failure in one does not block subsequent stages.
 * In particular, DB persistence failure no longer prevents SSE delivery.
 */
export function registerLogPipeline(ctx: EngineContext): void {
  // ── Middleware: DevMode visibility filter ───────────────
  appEvents.use('log', (data) =>
    isVisibleForMode(data.entry, getIssueDevMode(data.issueId)),
  )

  // ── Order 10: DB persistence ───────────────────────────
  appEvents.on(
    'log',
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
        // Enrich the shared entry object so downstream stages see messageId
        Object.assign(data.entry, persisted)
      }
      // DB failure does NOT block ring buffer (order 20) or SSE (order 100)
    },
    { order: 10 },
  )

  // ── Order 20: Ring buffer ──────────────────────────────
  appEvents.on(
    'log',
    (data) => {
      if (data.streaming) return
      const managed = ctx.pm.get(data.executionId)?.meta
      if (managed) managed.logs.push(data.entry)
    },
    { order: 20 },
  )

  // ── Order 30: Auto-title extraction ────────────────────
  appEvents.on(
    'log',
    (data) => {
      const managed = ctx.pm.get(data.executionId)?.meta
      if (
        managed?.metaTurn &&
        data.entry.entryType === 'assistant-message'
      ) {
        applyAutoTitle(data.issueId, data.entry.content)
      }
    },
    { order: 30 },
  )

  // ── Order 40: Logical failure detection ────────────────
  appEvents.on(
    'log',
    (data) => {
      if (data.streaming) return
      const managed = ctx.pm.get(data.executionId)?.meta
      if (!managed || managed.cancelledByUser) return
      const { entry } = data
      const resultSubtype = entry.metadata?.resultSubtype
      const isResultError =
        typeof resultSubtype === 'string' && resultSubtype !== 'success'
      if (isResultError || entry.metadata?.isError === true) {
        dispatch(managed, {
          type: 'SET_LOGICAL_FAILURE',
          reason:
            (entry.metadata?.error as string | undefined) ??
            String(resultSubtype ?? 'unknown'),
        })
      }
    },
    { order: 40 },
  )
}
