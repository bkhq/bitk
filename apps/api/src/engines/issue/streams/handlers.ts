import type { EngineContext } from '@/engines/issue/context'
import type { NormalizedLogEntry } from '@/engines/types'
import { appEvents } from '@/events'

// ---------- Stdout stream entry handler ----------

/**
 * Emit entry to the unified event bus. All processing (DB persistence,
 * ring buffer, auto-title, logical failure detection) is handled by
 * pipeline subscribers registered in pipeline.ts.
 */
export function handleStreamEntry(
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): void {
  const streaming = entry.metadata?.streaming === true
  // Normalize content before it enters the pipeline so every subscriber
  // (DB persistence, SSE broadcast, ring buffer, etc.) sees the same value.
  const trimmed = entry.content.trim()
  const effectiveEntry = trimmed === entry.content ? entry : { ...entry, content: trimmed }
  appEvents.emit('log', {
    issueId,
    executionId,
    entry: effectiveEntry,
    streaming,
  })
}

// ---------- Stderr entry handler ----------

export function handleStderrEntry(
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): void {
  const trimmed = entry.content.trim()
  const effectiveEntry = trimmed === entry.content ? entry : { ...entry, content: trimmed }
  appEvents.emit('log', {
    issueId,
    executionId,
    entry: effectiveEntry,
    streaming: false,
  })
}

// ---------- Stream error handler ----------

export function handleStreamError(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  error: unknown,
): void {
  // Guard: skip if execution was already cleaned up (cancel/GC/settle)
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed) return
  const turnIdx = ctx.turnIndexes.get(executionId) ?? 0
  const errorEntry: NormalizedLogEntry = {
    entryType: 'error-message',
    content: error instanceof Error ? error.message : 'Stream read error',
    turnIndex: turnIdx,
    timestamp: new Date().toISOString(),
  }
  appEvents.emit('log', {
    issueId,
    executionId,
    entry: errorEntry,
    streaming: false,
  })
}
