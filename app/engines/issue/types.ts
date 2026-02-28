import type { NormalizedLogEntry, PermissionPolicy, ProcessStatus, SpawnedProcess } from '../types'

export interface ManagedProcess {
  executionId: string
  issueId: string
  process: SpawnedProcess
  state: ProcessStatus
  startedAt: Date
  finishedAt?: Date
  exitCode?: number
  logs: NormalizedLogEntry[]
  retryCount: number
  turnInFlight: boolean
  queueCancelRequested: boolean
  logicalFailure: boolean
  logicalFailureReason?: string
  cancelledByUser: boolean
  /** True when handleTurnCompleted() has settled the issue (DB updated, events emitted)
   *  but the subprocess is still alive (conversational engines). Prevents monitorCompletion()
   *  from re-settling on exit, and is reset when a new turn starts. */
  turnSettled: boolean
  /** True when the current turn was initiated by a meta follow-up (e.g. auto-title).
   *  All log entries in this turn will be tagged with `type: 'system'` and hidden by isVisibleForMode(). */
  metaTurn: boolean
  slashCommands: string[]
  worktreePath?: string
  pendingInputs: Array<{
    prompt: string
    model?: string
    permissionMode?: PermissionPolicy
    busyAction: 'queue' | 'cancel'
    displayPrompt?: string
    metadata?: Record<string, unknown>
  }>
}

export type LogCallback = (issueId: string, executionId: string, entry: NormalizedLogEntry) => void
export type StateChangeCallback = (issueId: string, executionId: string, state: ProcessStatus) => void
export type IssueSettledCallback = (issueId: string, executionId: string, state: string) => void
export type UnsubscribeFn = () => void
