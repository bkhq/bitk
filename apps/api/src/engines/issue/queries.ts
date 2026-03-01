import type { NormalizedLogEntry } from '@/engines/types'
import type { EngineContext } from './context'
import { getLogsFromDb } from './persistence/queries'
import { cancel } from './process/cancel'
import { getActiveProcesses, getActiveProcessForIssue } from './process/state'
import type { ManagedProcess } from './types'
import { isVisibleForMode, setIssueDevMode } from './utils/visibility'

// ---------- Public read-only queries ----------

export function getLogs(
  ctx: EngineContext,
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: string // ULID id — fetch entries after this
    before?: string // ULID id — fetch entries before this
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

  // Only merge in-memory entries that are NEWER than a lower bound.
  // The ring buffer can hold up to 10k entries while the DB page is
  // limited (e.g. 61). Including old ring buffer entries that simply
  // fell outside the DB page window would break sort order and cause
  // the route handler's slice logic to return stale messages.
  //
  // Lower bound selection:
  //   cursor mode  → entries must be after the cursor (forward pagination)
  //   reverse mode → entries must be after the DB page's newest entry
  //   neither      → no bound (include all ring buffer entries)
  const newestDbId = persisted.length > 0
    ? persisted[persisted.length - 1].messageId
    : undefined
  const lowerBound = opts?.cursor ?? newestDbId

  const merged = [...persisted]
  for (const entry of active.logs.toArray()) {
    if (!isVisibleForMode(entry, devMode)) continue
    const key = entry.messageId
      ? `id:${entry.messageId}`
      : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
    if (seen.has(key)) continue
    // Skip entries at or below the lower bound — they are persisted but
    // outside the page window. Including them would break chronological order.
    if (lowerBound && entry.messageId && entry.messageId <= lowerBound) continue
    seen.add(key)
    merged.push(entry)
  }

  // Final safety sort by messageId (ULID) to guarantee chronological order.
  // Entries without messageId (persist failures) sort to the end.
  merged.sort((a, b) => {
    if (a.messageId && b.messageId)
      return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0
    if (a.messageId && !b.messageId) return -1
    if (!a.messageId && b.messageId) return 1
    return 0
  })

  return merged
}

export function getProcess(
  ctx: EngineContext,
  executionId: string,
): ManagedProcess | undefined {
  return ctx.pm.get(executionId)?.meta
}

export function hasActiveProcessForIssue(
  ctx: EngineContext,
  issueId: string,
): boolean {
  return getActiveProcessForIssue(ctx, issueId) !== undefined
}

export function isTurnInFlight(ctx: EngineContext, issueId: string): boolean {
  const active = getActiveProcessForIssue(ctx, issueId)
  return !!active && active.turnInFlight
}

export function getSlashCommands(
  ctx: EngineContext,
  issueId: string,
): string[] {
  const active = getActiveProcessForIssue(ctx, issueId)
  return active?.slashCommands ?? []
}

export async function cancelAll(ctx: EngineContext): Promise<void> {
  const active = getActiveProcesses(ctx)
  await Promise.all(
    active.map((p) => cancel(ctx, p.executionId, { hard: true })),
  )
}
