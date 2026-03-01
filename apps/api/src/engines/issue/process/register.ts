import type { EngineContext } from '@/engines/issue/context'
import type { StreamCallbacks } from '@/engines/issue/streams/consumer'
import type { ManagedProcess } from '@/engines/issue/types'
import type { NormalizedLogEntry, SpawnedProcess } from '@/engines/types'
import { MAX_LOG_ENTRIES } from '@/engines/issue/constants'
import { emitStateChange } from '@/engines/issue/events'
import { consumeStderr, consumeStream } from '@/engines/issue/streams/consumer'
import {
  handleStderrEntry,
  handleStreamEntry,
  handleStreamError,
} from '@/engines/issue/streams/handlers'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { RingBuffer } from '@/engines/issue/utils/ring-buffer'
import { logger } from '@/logger'

// ---------- Process registration ----------

export function register(
  ctx: EngineContext,
  executionId: string,
  issueId: string,
  process: SpawnedProcess,
  logParser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  turnIndex: number,
  worktreePath: string | undefined,
  metaTurn: boolean,
  onTurnCompleted: () => void,
): ManagedProcess {
  const managed: ManagedProcess = {
    executionId,
    issueId,
    process,
    state: 'running',
    startedAt: new Date(),
    logs: new RingBuffer<NormalizedLogEntry>(MAX_LOG_ENTRIES),
    retryCount: 0,
    turnInFlight: true,
    queueCancelRequested: false,
    logicalFailure: false,
    cancelledByUser: false,
    turnSettled: false,
    metaTurn,
    slashCommands: [],
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
    emitStateChange(ctx, issueId, executionId, 'running')
  }

  const stdoutCallbacks: StreamCallbacks = {
    getManaged: () => ctx.pm.get(executionId)?.meta,
    getTurnIndex: () => ctx.turnIndexes.get(executionId) ?? 0,
    onEntry: (entry) => handleStreamEntry(ctx, issueId, executionId, entry),
    onTurnCompleted,
    onStreamError: (error) => handleStreamError(ctx, issueId, executionId, error),
  }
  const stderrCallbacks = {
    getManaged: () => ctx.pm.get(executionId)?.meta,
    getTurnIndex: () => ctx.turnIndexes.get(executionId) ?? 0,
    onEntry: (entry: NormalizedLogEntry) => handleStderrEntry(ctx, issueId, executionId, entry),
  }

  consumeStream(executionId, issueId, process.stdout, logParser, stdoutCallbacks)
  consumeStderr(executionId, issueId, process.stderr, stderrCallbacks)
  logger.debug(
    { issueId, executionId, pid: getPidFromManaged(managed), turnIndex },
    'issue_process_registered',
  )

  return managed
}
