import type { NormalizedLogEntry } from '../../types'
import type { EngineContext } from '../context'
import { persistLogEntry } from './log-entry'

// ---------- Entry persistence ----------

/** Persist a log entry using context counters and return the persisted entry. */
export function persistEntry(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
): NormalizedLogEntry | null {
  const idx = ctx.entryCounters.get(executionId) ?? 0
  const turnIdx = ctx.turnIndexes.get(executionId) ?? 0
  const replyTo
    = entry.entryType !== 'user-message'
      ? (ctx.userMessageIds.get(`${issueId}:${turnIdx}`) ?? null)
      : null
  const persisted = persistLogEntry(issueId, executionId, entry, idx, turnIdx, replyTo)
  if (persisted) {
    ctx.entryCounters.set(executionId, idx + 1)
  }
  return persisted
}
