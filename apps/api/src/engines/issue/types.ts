import type {
  EngineType,
  NormalizedLogEntry,
  PermissionPolicy,
  ProcessStatus,
  SpawnedProcess,
} from '@/engines/types'
import type { RingBuffer } from './utils/ring-buffer'

export interface ManagedProcess {
  executionId: string
  issueId: string
  engineType: EngineType
  process: SpawnedProcess
  state: ProcessStatus
  startedAt: Date
  finishedAt?: Date
  exitCode?: number
  logs: RingBuffer<NormalizedLogEntry>
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
  /** The full command used to spawn this process (e.g. "claude -p --output-format=stream-json ...") */
  spawnCommand?: string
  /** Timestamp when the last turn completed and the process became idle */
  lastIdleAt?: Date
  /** Timestamp of the last stdout/stderr activity (updated on every stream entry) */
  lastActivityAt: Date
  /** Git repo directory that owns this worktree (needed for `git worktree remove`) */
  worktreeBaseDir?: string
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
