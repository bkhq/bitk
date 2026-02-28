import type { NormalizedLogEntry, SpawnedProcess } from '../types'
import type { EngineContext } from './context'
import type { StreamCallbacks } from './streams'
import type { ManagedProcess } from './types'
import { logger } from '../../logger'
import { getPidFromManaged } from './context'
import { emitStateChange } from './events'
import { handleStderrEntry, handleStreamEntry, handleStreamError } from './stream-handlers'
import { consumeStderr, consumeStream } from './streams'

// Re-export split modules so existing consumers keep working
export { persistEntry } from './persist-entry'
export { handleStderrEntry, handleStreamEntry, handleStreamError } from './stream-handlers'
export { persistUserMessage, sendInputToRunningProcess } from './user-message'

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
    logs: [],
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
