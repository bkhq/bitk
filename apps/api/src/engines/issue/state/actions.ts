export type ManagedAction
  = | { type: 'START_TURN', metaTurn: boolean }
    | { type: 'TURN_COMPLETED' }
    | { type: 'SET_EXIT_CODE', exitCode: number | undefined }
    | { type: 'MARK_COMPLETED' }
    | { type: 'MARK_FAILED', finishedAt?: Date }
    | { type: 'MARK_CANCELLED', finishedAt?: Date }
    | { type: 'SET_LOGICAL_FAILURE', reason: string }
    | { type: 'QUEUE_INPUT', input: Record<string, unknown> }
    | { type: 'REQUEST_QUEUE_CANCEL' }
    | { type: 'CLEAR_PENDING_INPUTS' }
    | { type: 'SPLICE_PENDING_INPUTS', count: number }
