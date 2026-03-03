import type { NormalizedLogEntry } from '@/engines/types'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import type { EngineContext } from './context'
import { emitStateChange } from './events'
import { dispatch } from './state'
import type { ManagedProcess } from './types'
import { getPidFromManaged } from './utils/pid'

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

  // Emit through pipeline — handles DB persist (order 10), ring buffer (order 20),
  // and SSE broadcast (order 100).  Pipeline enriches data.entry with messageId.
  // Keep a reference to the event data so we can read the enriched entry after
  // the synchronous emit completes (persist stage replaces data.entry, not the
  // local `entry` variable).
  const eventData = { issueId, executionId, entry, streaming: false as const }
  appEvents.emit('log', eventData)

  // Store user message ID so agent responses in this turn can reference it
  const messageId =
    (eventData.entry as { messageId?: string }).messageId ?? null
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
    throw new Error(
      'Active process does not support interactive follow-up input',
    )
  }

  // IMPORTANT: send to engine first, then persist.
  // If send throws (e.g. stdin closed in a race), caller may fallback to spawn
  // a new process. Persisting before send would duplicate this message across turns.
  handler.sendUserMessage(prompt)
  dispatch(managed, {
    type: 'START_TURN',
    metaTurn: metadata?.type === 'system',
  })
  // Emit running state BEFORE user message so the frontend resets doneReceivedRef
  // and accepts the subsequent user message SSE event.
  emitStateChange(issueId, managed.executionId, 'running')
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
