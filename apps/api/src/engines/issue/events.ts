import type { ProcessStatus } from '@/engines/types'
import { appEvents } from '@/events'

// ---------- Thin event emitters ----------
// Delegates to the unified AppEventBus. See pipeline.ts for log event handling.

export function emitStateChange(issueId: string, executionId: string, state: ProcessStatus): void {
  appEvents.emit('state', { issueId, executionId, state })
}

export function emitIssueSettled(issueId: string, executionId: string, status: string): void {
  // Only emit 'done' — callers already emit 'state' via emitStateChange() before
  // calling emitIssueSettled(), and the SSE route filters terminal states from
  // the 'state' subscriber anyway (handled by the 'done' subscriber instead).
  appEvents.emit('done', { issueId, executionId, finalStatus: status })
}
