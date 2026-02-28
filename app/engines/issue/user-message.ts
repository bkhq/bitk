import type { NormalizedLogEntry } from '../types'
import type { EngineContext } from './context'
import type { ManagedProcess } from './types'
import { logger } from '../../logger'
import { getPidFromManaged } from './context'
import { emitLog, emitStateChange } from './events'
import { persistEntry } from './persist-entry'

// ---------- User message persistence ----------

export function persistUserMessage(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  prompt: string,
  displayPrompt?: string,
  metadata?: Record<string, unknown>,
): string | null {
  const turnIdx = ctx.turnIndexes.get(executionId) ?? 0
  // When displayPrompt is provided on a meta turn, the user wants this message visible.
  // Strip type:'system' so isVisibleForMode() won't hide it.
  let entryMeta = metadata
  if (displayPrompt && metadata?.type === 'system') {
    const { type: _type, ...rest } = metadata
    entryMeta = Object.keys(rest).length > 0 ? rest : undefined
  }
  const entry: NormalizedLogEntry = {
    entryType: 'user-message',
    content: (displayPrompt ?? prompt).trim(),
    turnIndex: turnIdx,
    timestamp: new Date().toISOString(),
    ...(entryMeta ? { metadata: entryMeta } : {}),
  }

  // Persist first, then emit (DB is source of truth)
  const persisted = persistEntry(ctx, issueId, executionId, entry)
  if (persisted) {
    // Push persisted (with messageId) to in-memory logs for dedup
    const managed = ctx.pm.get(executionId)?.meta
    if (managed) {
      managed.logs.push(persisted)
    }
    emitLog(ctx, issueId, executionId, persisted)
  }

  // Store user message ID so agent responses in this turn can reference it
  const messageId = persisted?.messageId ?? null
  if (messageId) {
    ctx.userMessageIds.set(`${issueId}:${turnIdx}`, messageId)
  }
  return messageId
}

// ---------- Send input to running process ----------

export function sendInputToRunningProcess(
  ctx: EngineContext,
  issueId: string,
  managed: ManagedProcess,
  prompt: string,
  displayPrompt?: string,
  metadata?: Record<string, unknown>,
): string | null {
  if (managed.state !== 'running') {
    throw new Error('Cannot send input to a non-running process')
  }
  const handler = managed.process.protocolHandler
  if (!handler?.sendUserMessage) {
    throw new Error('Active process does not support interactive follow-up input')
  }

  // IMPORTANT: send to engine first, then persist.
  // If send throws (e.g. stdin closed in a race), caller may fallback to spawn
  // a new process. Persisting before send would duplicate this message across turns.
  handler.sendUserMessage(prompt)
  managed.turnInFlight = true
  managed.queueCancelRequested = false
  // Reset turn-level flags for the new turn so previous turn's state doesn't leak.
  managed.turnSettled = false
  managed.logicalFailure = false
  managed.logicalFailureReason = undefined
  managed.cancelledByUser = false
  managed.metaTurn = metadata?.type === 'system'
  // Emit running state BEFORE user message so the frontend resets doneReceivedRef
  // and accepts the subsequent user message SSE event.
  emitStateChange(ctx, issueId, managed.executionId, 'running')
  const messageId = persistUserMessage(
    ctx,
    issueId,
    managed.executionId,
    prompt,
    displayPrompt,
    metadata,
  )
  logger.debug(
    {
      issueId,
      executionId: managed.executionId,
      pid: getPidFromManaged(managed),
      promptChars: prompt.length,
      metaTurn: managed.metaTurn,
    },
    'issue_process_input_sent',
  )
  return messageId
}
