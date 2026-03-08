import type { NormalizedLogEntry } from '@/engines/types'
import { appEvents } from '@/events'

// ---------- Diagnostic log entries ----------
// Emits system-message entries into the issue log pipeline so they're persisted
// in the DB and visible in the issue's log timeline for debugging.

export function emitDiagnosticLog(
  issueId: string,
  executionId: string,
  content: string,
  extra?: Record<string, unknown>,
): void {
  const entry: NormalizedLogEntry = {
    entryType: 'system-message',
    content,
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    metadata: {
      subtype: 'diagnostic',
      ...extra,
    },
  }
  appEvents.emit('log', {
    issueId,
    executionId,
    entry,
    streaming: false,
  })
}
