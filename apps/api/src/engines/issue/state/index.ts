import type { ManagedAction } from './actions'
import type { ManagedProcess } from '@/engines/issue/types'

export function dispatch(managed: ManagedProcess, action: ManagedAction): void {
  switch (action.type) {
    case 'START_TURN':
      managed.turnInFlight = true
      managed.queueCancelRequested = false
      managed.turnSettled = false
      managed.logicalFailure = false
      managed.logicalFailureReason = undefined
      managed.cancelledByUser = false
      managed.metaTurn = action.metaTurn
      break
    case 'TURN_COMPLETED':
      managed.turnInFlight = false
      managed.queueCancelRequested = false
      managed.metaTurn = false
      managed.turnSettled = true
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
      managed.cancelledByUser = action.cancelledByUser
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
  }
}

export type { ManagedAction } from './actions'
