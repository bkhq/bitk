import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Pure classification functions ----------

export function isTurnCompletionEntry(entry: NormalizedLogEntry): boolean {
  if (entry.metadata?.turnCompleted === true) return true
  if (
    entry.metadata &&
    Object.prototype.hasOwnProperty.call(entry.metadata, 'resultSubtype')
  ) {
    return true
  }
  return (
    entry.entryType === 'system-message' &&
    !!entry.metadata &&
    Object.prototype.hasOwnProperty.call(entry.metadata, 'duration')
  )
}

export function isCancelledNoiseEntry(entry: NormalizedLogEntry): boolean {
  const subtype = entry.metadata?.resultSubtype
  if (typeof subtype !== 'string' || subtype !== 'error_during_execution')
    return false
  const raw =
    `${entry.content ?? ''} ${String(entry.metadata?.error ?? '')}`.toLowerCase()
  return (
    raw.includes('request was aborted') ||
    raw.includes('request interrupted by user') ||
    raw.includes('rust analyzer lsp crashed') ||
    raw.includes('rust-analyzer-lsp')
  )
}
