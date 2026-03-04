import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import type { EngineContext } from '@/engines/issue/context'
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

  // Wire up protocol handler activity callback so control_request messages
  // (filtered from the downstream stdout stream) still update lastActivityAt.
  // This prevents false stall detection during long-running tool executions
  // where the process is alive but not producing normal log entries.
  // Wire once — guard prevents overwriting if register() is called multiple times.
  if (process.protocolHandler && !process.protocolHandler.onActivity) {
    const getManagedRef = stdoutCallbacks.getManaged
    process.protocolHandler.onActivity = () => {
      const m = getManagedRef()
      if (m) {
        m.lastActivityAt = new Date()
        if (m.stallProbeAt) m.stallProbeAt = undefined
      }
    }
  }

  consumeStream(
    executionId,
    issueId,
    process.stdout,
    logParser,
    stdoutCallbacks,
  )
  consumeStderr(executionId, issueId, process.stderr, stderrCallbacks)
  logger.debug(
    { issueId, executionId, pid: getPidFromManaged(managed), turnIndex },
    'issue_process_registered',
  )

  return managed
}
