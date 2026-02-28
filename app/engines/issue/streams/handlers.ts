import type { NormalizedLogEntry } from '../../types'
import type { EngineContext } from '../context'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { issueLogs as logsTable } from '../../../db/schema'
import { emitLog } from '../events'
import { persistEntry } from '../persistence/entry'
import { buildToolDetail, persistToolDetail } from '../persistence/tool-detail'
import { dispatch } from '../state'
import { applyAutoTitle } from '../title'

// ---------- Stdout stream entry handler ----------

export function handleStreamEntry(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed) return

  // Intercept auto-title pattern from AI response in meta turns
  if (managed.metaTurn && entry.entryType === 'assistant-message') {
    applyAutoTitle(issueId, entry.content)
  }

  // Persist first, then emit (DB is source of truth)
  // For tool-use entries, content & metadata are stored in the tools table only
  const isToolUse = entry.entryType === 'tool-use'
  const dbEntry = isToolUse ? { ...entry, content: '', metadata: undefined } : entry
  const persisted = persistEntry(ctx, issueId, executionId, dbEntry)
  if (persisted) {
    if (isToolUse && persisted.messageId) {
      const detail = buildToolDetail(entry)
      if (detail) persisted.toolDetail = detail
      // Restore content/metadata on the in-memory entry for emitting to live clients
      persisted.content = entry.content
      persisted.metadata = entry.metadata
      const toolRecordId = persistToolDetail(persisted.messageId, issueId, entry)
      if (toolRecordId) {
        db.update(logsTable)
          .set({ toolCallRefId: toolRecordId })
          .where(eq(logsTable.id, persisted.messageId))
          .run()
      }
    }
    // Push persisted entry (with messageId) so getLogs dedup works correctly
    managed.logs.push(persisted)
    emitLog(ctx, issueId, executionId, persisted)
  } else {
    // Persist failed — keep original entry in memory as fallback
    managed.logs.push(entry)
  }

  const resultSubtype = entry.metadata?.resultSubtype
  const isResultError = typeof resultSubtype === 'string' && resultSubtype !== 'success'
  if (!managed.cancelledByUser && (isResultError || entry.metadata?.isError === true)) {
    dispatch(managed, {
      type: 'SET_LOGICAL_FAILURE',
      reason: (entry.metadata?.error as string | undefined) ?? String(resultSubtype ?? 'unknown'),
    })
  }
}

// ---------- Stderr entry handler ----------

export function handleStderrEntry(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): void {
  const persisted = persistEntry(ctx, issueId, executionId, entry)
  if (persisted) {
    emitLog(ctx, issueId, executionId, persisted)
  }
}

// ---------- Stream error handler ----------

export function handleStreamError(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  error: unknown,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed) return
  const turnIdx = ctx.turnIndexes.get(executionId) ?? 0
  const errorEntry: NormalizedLogEntry = {
    entryType: 'error-message',
    content: error instanceof Error ? error.message : 'Stream read error',
    turnIndex: turnIdx,
    timestamp: new Date().toISOString(),
  }
  managed.logs.push(errorEntry)
  const persisted = persistEntry(ctx, issueId, executionId, errorEntry)
  if (persisted) {
    emitLog(ctx, issueId, executionId, persisted)
  }
}
