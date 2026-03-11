import type { ManagedProcess } from '@/engines/issue/types'
import type { ManagedAction } from './actions'

// ManagedProcess is intentionally mutated in-place. The ProcessManager uses
// identity-based lookups (ctx.pm.get(id)?.meta) so creating copies would
// break reference equality across all consumers. This is a known exception
// to the project's immutability convention.
export function dispatch(managed: ManagedProcess, action: ManagedAction): void {
  switch (action.type) {
    case 'START_TURN':
      managed.turnInFlight = true
      managed.lastActivityAt = new Date()
      managed.queueCancelRequested = false
      managed.turnSettled = false
      managed.logicalFailure = false
      managed.logicalFailureReason = undefined
      managed.lastInterruptAt = undefined
      managed.cancelEscalationId = undefined // Invalidate stale cancel escalation
      managed.stallDetectedAt = undefined
      managed.stallProbeAt = undefined
      managed.metaTurn = action.metaTurn
      // Cancel any pending settle timer — a new turn started before the
      // grace period expired, so the issue should stay in 'working'.
      if (managed.settleTimer) {
        clearTimeout(managed.settleTimer)
        managed.settleTimer = undefined
      }
      break
    case 'TURN_COMPLETED':
      managed.turnInFlight = false
      managed.queueCancelRequested = false
      managed.metaTurn = false
      managed.turnSettled = true
      // lastInterruptAt is NOT reset here — it stays set through the full
      // stream drain cycle so isCancelledNoiseEntry filtering works. It is
      // reset in START_TURN when the next turn begins.
      break
    case 'SET_EXIT_CODE':
      managed.exitCode = action.exitCode
      managed.finishedAt = new Date()
      break
    case 'MARK_COMPLETED':
      managed.state = 'completed'
      managed.finishedAt ??= new Date()
      managed.pendingInputs = []
      break
    case 'MARK_FAILED':
      managed.state = 'failed'
      managed.finishedAt = action.finishedAt ?? new Date()
      managed.pendingInputs = []
      break
    case 'MARK_CANCELLED':
      managed.state = 'cancelled'
      managed.finishedAt = action.finishedAt ?? new Date()
      break
    case 'SET_LOGICAL_FAILURE':
      managed.logicalFailure = true
      managed.logicalFailureReason = action.reason
      break
    case 'QUEUE_INPUT':
      managed.pendingInputs.push(action.input as any)
      break
    case 'REQUEST_QUEUE_CANCEL':
      managed.queueCancelRequested = true
      break
    case 'CLEAR_PENDING_INPUTS':
      managed.pendingInputs = []
      break
    case 'SPLICE_PENDING_INPUTS':
      managed.pendingInputs = managed.pendingInputs.slice(action.count)
      break
  }
}

export type { ManagedAction } from './actions'
