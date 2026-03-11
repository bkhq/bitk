import type { EngineType, PermissionPolicy, ProcessStatus, SpawnedProcess } from '@/engines/types'
import type { IssueDebugLog } from './debug-log'
import type { ExecutionStore } from './store/execution-store'

export interface ManagedProcess {
  executionId: string
  issueId: string
  engineType: EngineType
  process: SpawnedProcess
  state: ProcessStatus
  startedAt: Date
  finishedAt?: Date
  exitCode?: number
  logs: ExecutionStore
  retryCount: number
  turnInFlight: boolean
  queueCancelRequested: boolean
  logicalFailure: boolean
  logicalFailureReason?: string
  /**
   * Timestamp of the last user-initiated interrupt (cancel). Used for
   *  post-interrupt noise filtering: entries within 5s of an interrupt are
   *  suppressed. Reset when a new turn starts.
   */
  lastInterruptAt?: Date
  /**
   * True when handleTurnCompleted() has settled the issue (DB updated, events emitted)
   *  but the subprocess is still alive (conversational engines). Prevents monitorCompletion()
   *  from re-settling on exit, and is reset when a new turn starts.
   */
  turnSettled: boolean
  /**
   * True when the current turn was initiated by a meta follow-up (e.g. auto-title).
   *  All log entries in this turn will be tagged with `type: 'system'` and hidden by isVisible().
   */
  metaTurn: boolean
  slashCommands: string[]
  agents: string[]
  plugins: Array<{ name: string, path: string }>
  /** The full command used to spawn this process (e.g. "claude -p --output-format=stream-json ...") */
  spawnCommand?: string
  /** Timestamp when the last turn completed and the process became idle */
  lastIdleAt?: Date
  /** Timestamp of the last stdout/stderr activity (updated on every stream entry) */
  lastActivityAt: Date
  /**
   * Timestamp when stall was first detected (non-destructive liveness check).
   *  If activity resumes, this is cleared in consumeStream.
   */
  stallDetectedAt?: Date
  /**
   * Timestamp when a stall-probe interrupt was sent (set by gcSweep).
   *  If activity resumes after the probe, this is cleared in consumeStream.
   *  If still no activity after STALL_INTERRUPT_GRACE_MS, the process is force-killed.
   */
  stallProbeAt?: Date
  /**
   * Unique ID for the current cancel escalation. Set when cancelIssue fires
   *  the async escalation loop, cleared when a new turn starts (START_TURN).
   *  Allows the escalation to detect that a follow-up has reactivated the
   *  process and abort instead of hard-killing a legitimate turn.
   */
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
  /** Per-issue debug file logger for raw I/O and lifecycle events */
  debugLog?: IssueDebugLog
  /**
   * True when stdout pipe closed prematurely while the process is still alive.
   *  Transcript fallback is in progress — stall detection should not escalate.
   */
  stdoutBroken?: boolean
  /**
   * UUID of the last stdout message processed (used by transcript fallback
   *  to skip already-seen entries).
   */
  lastSeenUuid?: string
  /** CWD of the spawned process (needed to construct transcript JSONL path). */
  spawnCwd?: string
  /** External session ID (Claude CLI session UUID). */
  externalSessionId?: string
  /**
   * Promise that resolves when the stdout stream consumer finishes draining
   * all buffered data. monitorCompletion awaits this before settling the issue
   * to prevent the race where status moves to "review" while logs are still streaming.
   */
  stdoutDone?: Promise<void>
  /**
   * Timer handle for the delayed autoMoveToReview after a turn completes.
   * Cleared when a new turn starts (START_TURN) so that follow-ups sent
   * within the grace period prevent the premature review transition.
   */
  settleTimer?: ReturnType<typeof setTimeout>
}
