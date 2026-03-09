import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Log visibility ----------

/**
 * Visibility filter — everything is stored in DB, this controls display.
 *
 * Used at two boundaries:
 *  - SSE gate (events.ts) — prevents noise from reaching the client
 *  - DB post-filter (queries.ts) — trims paginated results
 */
export function isVisible(entry: NormalizedLogEntry): boolean {
  // Meta-turn entries (auto-title etc.) are always hidden
  if (entry.metadata?.type === 'system') return false

  // Entry types with no user-facing value — suppress at SSE + DB boundary
  if (entry.entryType === 'token-usage' || entry.entryType === 'loading') return false

  // System-message subtypes that are internal noise
  if (entry.entryType === 'system-message') {
    const subtype = entry.metadata?.subtype as string | undefined
    if (subtype === 'init' || subtype === 'hook_response' || subtype === 'stop_hook_summary') return false
  }

  // All other types pass through: user-message, assistant-message, tool-use,
  // thinking, error-message, system-message (compact_boundary, status, etc.)
  return true
}
