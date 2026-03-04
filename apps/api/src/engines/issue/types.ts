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
  /** Timestamp of the last user-initiated interrupt (cancel). Used for
   *  post-interrupt noise filtering: entries within 5s of an interrupt are
   *  suppressed. Reset when a new turn starts. */
  lastInterruptAt?: Date
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
  /** Timestamp when a stall-probe interrupt was sent (set by gcSweep).
   *  If activity resumes after the probe, this is cleared in consumeStream.
   *  If still no activity after STALL_PROBE_GRACE_MS, the process is force-killed. */
  stallProbeAt?: Date
  /** Unique ID for the current cancel escalation. Set when cancelIssue fires
   *  the async escalation loop, cleared when a new turn starts (START_TURN).
   *  Allows the escalation to detect that a follow-up has reactivated the
   *  process and abort instead of hard-killing a legitimate turn. */
  cancelEscalationId?: string
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
