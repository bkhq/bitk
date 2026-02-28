import type { EngineContext } from './context'
import type { ManagedProcess } from './types'
import type { NormalizedLogEntry } from '@/engines/types'
import { getLogsFromDb } from './persistence/queries'
import { cancel } from './process/cancel'
import { getActiveProcesses, getActiveProcessForIssue } from './process/state'
import { isVisibleForMode, setIssueDevMode } from './utils/visibility'

// ---------- Public read-only queries ----------

export function getLogs(
  ctx: EngineContext,
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: { turnIndex: number; entryIndex: number }
    before?: { turnIndex: number; entryIndex: number }
    limit?: number
  },
): NormalizedLogEntry[] {
  setIssueDevMode(issueId, devMode)
  // DB pre-filters by visible + entryType; isVisibleForMode() handles subtype rules.
  const persisted = getLogsFromDb(issueId, devMode, opts)

  // When loading older entries (before cursor), skip in-memory merge —
  // in-memory logs are always the newest and irrelevant for historical pages.
  if (opts?.before) return persisted

  // While a process is active, merge any in-memory tail not yet persisted.
  const active = getActiveProcessForIssue(ctx, issueId)
  if (!active || active.logs.length === 0) {
    return persisted
  }

  const seen = new Set(
    persisted.map((entry) =>
      entry.messageId
        ? `id:${entry.messageId}`
        : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`,
    ),
  )

  const merged = [...persisted]
  for (const entry of active.logs.toArray()) {
    if (!isVisibleForMode(entry, devMode)) continue
    const key = entry.messageId
      ? `id:${entry.messageId}`
      : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }

  return merged
}

export function getProcess(ctx: EngineContext, executionId: string): ManagedProcess | undefined {
  return ctx.pm.get(executionId)?.meta
}

export function hasActiveProcessForIssue(ctx: EngineContext, issueId: string): boolean {
  return getActiveProcessForIssue(ctx, issueId) !== undefined
}

export function isTurnInFlight(ctx: EngineContext, issueId: string): boolean {
  const active = getActiveProcessForIssue(ctx, issueId)
  return !!active && active.turnInFlight
}

export function getSlashCommands(ctx: EngineContext, issueId: string): string[] {
  const active = getActiveProcessForIssue(ctx, issueId)
  return active?.slashCommands ?? []
}

export async function cancelAll(ctx: EngineContext): Promise<void> {
  const active = getActiveProcesses(ctx)
  await Promise.all(active.map((p) => cancel(ctx, p.executionId, { hard: true })))
}
