import type { NormalizedLogEntry, SpawnedProcess } from '../../types'
import type { EngineContext } from '../context'
import type { StreamCallbacks } from '../streams/consumer'
import type { ManagedProcess } from '../types'
import { logger } from '../../../logger'
import { MAX_LOG_ENTRIES } from '../constants'
import { emitStateChange } from '../events'
import { consumeStderr, consumeStream } from '../streams/consumer'
import { handleStderrEntry, handleStreamEntry, handleStreamError } from '../streams/handlers'
import { getPidFromManaged } from '../utils/pid'
import { RingBuffer } from '../utils/ring-buffer'

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
  ctx.entryCounters.set(executionId, 0)
  ctx.turnIndexes.set(executionId, turnIndex)
  emitStateChange(ctx, issueId, executionId, 'running')

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
