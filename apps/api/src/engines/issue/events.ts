import type { ProcessStatus } from '@/engines/types'
import { appEvents } from '@/events'

// ---------- Thin event emitters ----------
// Delegates to the unified AppEventBus. See pipeline.ts for log event handling.

export function emitStateChange(
  issueId: string,
  executionId: string,
  state: ProcessStatus,
): void {
  appEvents.emit('state', { issueId, executionId, state })
}

export function emitIssueSettled(
  issueId: string,
  executionId: string,
  status: string,
): void {
  appEvents.emit('state', { issueId, executionId, state: status })
  appEvents.emit('done', { issueId, executionId, finalStatus: status })
}
