import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Log visibility ----------

/**
 * Single visibility filter — everything is stored in DB, this controls display.
 * devMode=true shows all entries; devMode=false shows only user-facing entries.
 */
export function isVisibleForMode(entry: NormalizedLogEntry, devMode: boolean): boolean {
  if (devMode) return true

  // Meta-turn entries (auto-title etc.) are always hidden
  if (entry.metadata?.type === 'system') return false

  // Non-dev mode: only user and assistant messages are visible
  return entry.entryType === 'user-message' || entry.entryType === 'assistant-message'
}

// ---------- Dev mode cache ----------

const devModeCache = new Map<string, boolean>()

export function getIssueDevMode(issueId: string): boolean {
  return devModeCache.get(issueId) ?? false
}

export function setIssueDevMode(issueId: string, devMode: boolean): void {
  devModeCache.set(issueId, devMode)
}
