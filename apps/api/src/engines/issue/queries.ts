import type { CategorizedCommands } from '@bkd/shared'
import { cacheDel } from '@/cache'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import type { EngineType } from '@/engines/types'
import type { EngineContext } from './context'
import type { LogQueryOpts, PaginatedLogResult } from './persistence/queries'
import { getLogsFromDb } from './persistence/queries'
import { cancel } from './process/cancel'
import { getActiveProcesses, getActiveProcessForIssue } from './process/state'
import type { ManagedProcess } from './types'
import { isVisible } from './utils/visibility'

const SLASH_COMMANDS_PREFIX = 'engine:slashCommands'

const EMPTY_CATEGORIZED: CategorizedCommands = {
  commands: [],
  agents: [],
  plugins: [],
}

/** All known engine types for cache loading. */
const ALL_ENGINE_TYPES: EngineType[] = ['claude-code', 'codex', 'acp']

/** Per-engine in-memory cache for categorized commands from DB. */
const cachedCommands = new Map<EngineType, CategorizedCommands>()

/** DB key for engine-specific slash commands. */
export function slashCommandsKey(engineType: EngineType): string {
  return `${SLASH_COMMANDS_PREFIX}:${engineType}`
}

/**
 * Parse raw DB value into CategorizedCommands.
 * Handles both legacy format (string[]) and new format (CategorizedCommands).
 */
function parseCategorized(raw: string): CategorizedCommands | null {
  try {
    const parsed = JSON.parse(raw)
    // Legacy format: plain string[]
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? { commands: parsed as string[], agents: [], plugins: [] } : null
    }
    // New format: { commands, agents, plugins }
    const cat = parsed as CategorizedCommands
    if (cat.commands?.length > 0 || cat.agents?.length > 0 || cat.plugins?.length > 0) {
      return {
        commands: cat.commands ?? [],
        agents: cat.agents ?? [],
        plugins: cat.plugins ?? [],
      }
    }
    return null
  } catch {
    return null
  }
}

/** Load categorized commands from DB into memory cache for all engines. */
export async function refreshSlashCommandsCache(): Promise<void> {
  await Promise.all(
    ALL_ENGINE_TYPES.map(async (et) => {
      const raw = await getAppSetting(slashCommandsKey(et))
      const cat = raw ? parseCategorized(raw) : null
      if (cat) {
        cachedCommands.set(et, cat)
      } else {
        cachedCommands.delete(et)
      }
    }),
  )
}

/** Refresh cache for a single engine type. */
export async function refreshSlashCommandsCacheForEngine(engineType: EngineType): Promise<void> {
  const raw = await getAppSetting(slashCommandsKey(engineType))
  const cat = raw ? parseCategorized(raw) : null
  if (cat) {
    cachedCommands.set(engineType, cat)
  } else {
    cachedCommands.delete(engineType)
  }
}

export function getCachedCategorizedCommands(engineType?: EngineType): CategorizedCommands {
  if (engineType) return cachedCommands.get(engineType) ?? EMPTY_CATEGORIZED
  // Fallback: merge all engines
  const merged: CategorizedCommands = { commands: [], agents: [], plugins: [] }
  for (const cat of cachedCommands.values()) {
    merged.commands.push(...cat.commands)
    merged.agents.push(...cat.agents)
    merged.plugins.push(...cat.plugins)
  }
  return merged
}

/** @deprecated Use getCachedCategorizedCommands instead. Kept for callers that only need command names. */
export function getCachedSlashCommands(engineType?: EngineType): string[] {
  return getCachedCategorizedCommands(engineType).commands
}

/**
 * One-time migration: move legacy global `engine:slashCommands` key to
 * the per-engine key `engine:slashCommands:claude-code` (the only engine
 * that previously reported slash commands). Safe to call multiple times.
 */
export async function migrateSlashCommandsKey(): Promise<void> {
  const LEGACY_KEY = 'engine:slashCommands'
  const raw = await getAppSetting(LEGACY_KEY)
  if (!raw) return
  // Only migrate if the new per-engine key doesn't exist yet
  const existing = await getAppSetting(slashCommandsKey('claude-code'))
  if (existing) return
  await setAppSetting(slashCommandsKey('claude-code'), raw)
  // Clean up legacy key from DB
  const { db } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.delete(appSettings).where(eq(appSettings.key, LEGACY_KEY))
  await cacheDel(`app_setting:${LEGACY_KEY}`)
}

// ---------- Public read-only queries ----------

export function getLogs(
  ctx: EngineContext,
  issueId: string,
  opts?: LogQueryOpts,
): PaginatedLogResult {
  // DB filters by visible=1; isVisible() post-filters by entry type.
  const result = getLogsFromDb(issueId, opts)

  // When loading older entries (before cursor), skip in-memory merge —
  // in-memory logs are always the newest and irrelevant for historical pages.
  if (opts?.before) return result

  // While a process is active, merge any in-memory tail not yet persisted.
  const active = getActiveProcessForIssue(ctx, issueId)
  if (!active || active.logs.length === 0) {
    return result
  }

  const persisted = result.entries
  const seen = new Set(
    persisted.map(entry =>
      entry.messageId ?
        `id:${entry.messageId}` :
        `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`,
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
  const newestDbId = persisted.at(-1)?.messageId
  const lowerBound = opts?.cursor ?? newestDbId

  // Build in-memory filter set to match DB-level entryTypes / turnIndex filters
  const entryTypeSet = opts?.entryTypes ? new Set(opts.entryTypes) : undefined
  const turnLower = opts?.turnIndex
  const turnUpper = opts?.turnIndexEnd

  const merged = [...persisted]
  for (const entry of active.logs.toArray()) {
    if (!isVisible(entry)) continue
    // Apply entryTypes filter
    if (entryTypeSet && !entryTypeSet.has(entry.entryType)) continue
    // Apply turnIndex range filter
    if (turnLower != null && (entry.turnIndex == null || entry.turnIndex < turnLower)) continue
    if (turnUpper != null && (entry.turnIndex == null || entry.turnIndex > turnUpper)) continue
    const key = entry.messageId ?
      `id:${entry.messageId}` :
      `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
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

  return { entries: merged, hasMore: result.hasMore }
}

export function getActiveProcessesList(ctx: EngineContext): ManagedProcess[] {
  return getActiveProcesses(ctx)
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

export function getCategorizedCommands(
  ctx: EngineContext,
  issueId: string,
  engineType?: EngineType,
): CategorizedCommands {
  const active = getActiveProcessForIssue(ctx, issueId)
  if (
    active &&
    (active.slashCommands.length > 0 || active.agents.length > 0 || active.plugins.length > 0)
  ) {
    return {
      commands: active.slashCommands,
      agents: active.agents,
      plugins: active.plugins,
    }
  }
  const et = active?.engineType ?? engineType
  return getCachedCategorizedCommands(et)
}

/** @deprecated Use getCategorizedCommands instead. */
export function getSlashCommands(
  ctx: EngineContext,
  issueId: string,
  engineType?: EngineType,
): string[] {
  return getCategorizedCommands(ctx, issueId, engineType).commands
}

export async function cancelAll(ctx: EngineContext): Promise<void> {
  const active = getActiveProcesses(ctx)
  await Promise.all(active.map(p => cancel(ctx, p.executionId, { hard: true })))
}
