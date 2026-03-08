import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import type { EngineContext } from '@/engines/issue/context'
import {
  createIssueDebugLog,
  teeStreamToDebug,
} from '@/engines/issue/debug-log'
import { emitStateChange } from '@/engines/issue/events'
import type { StreamCallbacks } from '@/engines/issue/streams/consumer'
import { consumeStderr, consumeStream } from '@/engines/issue/streams/consumer'
import {
  handleStderrEntry,
  handleStreamEntry,
  handleStreamError,
} from '@/engines/issue/streams/handlers'
import type { ManagedProcess } from '@/engines/issue/types'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { RingBuffer } from '@/engines/issue/utils/ring-buffer'
import type {
  EngineType,
  NormalizedLogEntry,
  SpawnedProcess,
} from '@/engines/types'
import { logger } from '@/logger'

// ---------- Process registration ----------

export function register(
  ctx: EngineContext,
  executionId: string,
  issueId: string,
  engineType: EngineType,
  process: SpawnedProcess,
  logParser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  turnIndex: number,
  worktreePath: string | undefined,
  metaTurn: boolean,
  onTurnCompleted: () => void,
  worktreeBaseDir?: string,
): ManagedProcess {
  const managed: ManagedProcess = {
    executionId,
    issueId,
    engineType,
    process,
    state: 'running',
    startedAt: new Date(),
    logs: new RingBuffer<NormalizedLogEntry>(MAX_LOG_ENTRIES),
    retryCount: 0,
    turnInFlight: true,
    queueCancelRequested: false,
    logicalFailure: false,
    turnSettled: false,
    metaTurn,
    lastActivityAt: new Date(),
    slashCommands: [],
    agents: [],
    plugins: [],
    spawnCommand: process.spawnCommand,
    worktreeBaseDir,
    worktreePath,
    pendingInputs: [],
  }

  ctx.pm.register(executionId, process.subprocess, managed, {
    group: issueId,
    startAsRunning: true,
  })
  // Preserve entryCounters if already initialised (e.g. when the user
  // message was persisted before the spawn to reduce perceived latency).
  // When already initialised, the caller (e.g. spawnFollowUpProcess) has
  // already emitted state:running — skip the duplicate emission to avoid
  // triggering two React Query invalidations racing each other.
  const alreadyInitialised = ctx.entryCounters.has(executionId)
  if (!alreadyInitialised) {
    ctx.entryCounters.set(executionId, 0)
  }
  ctx.turnIndexes.set(executionId, turnIndex)
  if (!alreadyInitialised) {
    emitStateChange(issueId, executionId, 'running')
  }

  const stdoutCallbacks: StreamCallbacks = {
    getManaged: () => ctx.pm.get(executionId)?.meta,
    getTurnIndex: () => ctx.turnIndexes.get(executionId) ?? 0,
    onEntry: (entry) => handleStreamEntry(issueId, executionId, entry),
    onTurnCompleted,
    onStreamError: (error) =>
      handleStreamError(ctx, issueId, executionId, error),
  }
  const stderrCallbacks = {
    getManaged: () => ctx.pm.get(executionId)?.meta,
    getTurnIndex: () => ctx.turnIndexes.get(executionId) ?? 0,
    onEntry: (entry: NormalizedLogEntry) =>
      handleStderrEntry(issueId, executionId, entry),
  }

  // Wire up protocol handler activity callback. This fires at two points:
  // 1. When raw data arrives from the process (earliest signal of liveness)
  // 2. When control_request messages are processed (filtered from downstream)
  // This prevents false stall detection when downstream processing is slow or
  // the process is alive but only sending control_requests (tool execution).
  // Wire once — guard prevents overwriting if register() is called multiple times.
  if (process.protocolHandler && !process.protocolHandler.onActivity) {
    const getManagedRef = stdoutCallbacks.getManaged
    process.protocolHandler.onActivity = () => {
      const m = getManagedRef()
      if (m) {
        m.lastActivityAt = new Date()
        if (m.stallDetectedAt) m.stallDetectedAt = undefined
        if (m.stallProbeAt) m.stallProbeAt = undefined
      }
    }
  }

  // Create per-issue debug log for raw I/O capture
  const debugLog = createIssueDebugLog(issueId, executionId)
  managed.debugLog = debugLog
  debugLog.event(
    `pid=${getPidFromManaged(managed)} engine=${engineType} turn=${turnIndex} cmd=${process.spawnCommand ?? 'unknown'}`,
  )

  // Tee streams: raw bytes go to debug file, downstream consumers get the same data
  const stdoutStream = teeStreamToDebug(process.stdout, debugLog, 'stdout')
  const stderrStream = teeStreamToDebug(process.stderr, debugLog, 'stderr')

  void consumeStream(
    executionId,
    issueId,
    stdoutStream,
    logParser,
    stdoutCallbacks,
  )
    .then(() => {
      debugLog.event('stdout_stream_ended')
      logger.debug({ issueId, executionId }, 'consume_stream_promise_resolved')
    })
    .catch((err) => {
      debugLog.event(`stdout_stream_error: ${err}`)
      logger.error(
        { issueId, executionId, err },
        'consume_stream_unhandled_error',
      )
    })
  void consumeStderr(executionId, issueId, stderrStream, stderrCallbacks)
    .then(() => {
      debugLog.event('stderr_stream_ended')
      logger.debug({ issueId, executionId }, 'consume_stderr_promise_resolved')
    })
    .catch((err) => {
      debugLog.event(`stderr_stream_error: ${err}`)
      logger.error(
        { issueId, executionId, err },
        'consume_stderr_unhandled_error',
      )
    })
  logger.debug(
    { issueId, executionId, pid: getPidFromManaged(managed), turnIndex },
    'issue_process_registered',
  )

  return managed
}
