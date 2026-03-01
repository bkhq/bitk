import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Log visibility ----------

/**
 * Single visibility filter — everything is stored in DB, this controls display.
 * devMode=true shows all entries; devMode=false shows only user-facing entries.
 */
export function isVisibleForMode(
  entry: NormalizedLogEntry,
  devMode: boolean,
): boolean {
  if (devMode) return true

  // Meta-turn entries (auto-title etc.) are always hidden
  if (entry.metadata?.type === 'system') return false

  // User & assistant messages are always visible
  if (
    entry.entryType === 'user-message' ||
    entry.entryType === 'assistant-message'
  )
    return true

  // Tool-use entries are only visible in dev mode
  if (entry.entryType === 'tool-use') return false

  // System messages — only command output and compact boundary
  if (entry.entryType === 'system-message') {
    const subtype = entry.metadata?.subtype
    return subtype === 'command_output' || subtype === 'compact_boundary'
  }

  return false
}

// ---------- Dev mode cache ----------

const devModeCache = new Map<string, boolean>()

export function getIssueDevMode(issueId: string): boolean {
  return devModeCache.get(issueId) ?? false
}

export function setIssueDevMode(issueId: string, devMode: boolean): void {
  devModeCache.set(issueId, devMode)
}
