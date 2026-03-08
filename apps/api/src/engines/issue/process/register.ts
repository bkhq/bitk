import {
  getTranscriptPath,
  runTranscriptFallback,
} from '@/engines/executors/claude/transcript-fallback'
import type { EngineContext } from '@/engines/issue/context'
import {
  createIssueDebugLog,
  teeStreamToDebug,
} from '@/engines/issue/debug-log'
import { emitDiagnosticLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { ExecutionStore } from '@/engines/issue/store/execution-store'
import type { StreamCallbacks } from '@/engines/issue/streams/consumer'
import { consumeStderr, consumeStream } from '@/engines/issue/streams/consumer'
import {
  handleStderrEntry,
  handleStreamEntry,
  handleStreamError,
} from '@/engines/issue/streams/handlers'
import type { ManagedProcess } from '@/engines/issue/types'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
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
    logs: new ExecutionStore(executionId),
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

      // Detect stdout pipe breakage: stream ended but process is still alive
      const m = ctx.pm.get(executionId)?.meta
      if (!m || m.turnSettled || m.state !== 'running') return
      const pid = getPidFromManaged(m)
      if (!pid) return
      let alive = false
      try {
        process.kill(pid, 0)
        alive = true
      } catch {
        // process already dead — normal exit path
      }
      if (!alive) return

      // stdout broke while process is still running
      m.stdoutBroken = true

      // Transcript JSONL fallback is Claude CLI-specific — other engines
      // (codex, gemini, echo) don't write transcript files.
      if (engineType !== 'claude-code') {
        debugLog.event(
          `stdout_broken pid=${pid} engine=${engineType} — no transcript fallback`,
        )
        logger.warn(
          { issueId, executionId, pid, engineType },
          'stdout_broken_no_fallback_non_claude',
        )
        return
      }

      const cwd = m.spawnCwd
      const sessionId = m.externalSessionId
      if (!cwd || !sessionId) {
        logger.warn(
          { issueId, executionId, hasCwd: !!cwd, hasSessionId: !!sessionId },
          'transcript_fallback_skipped_missing_context',
        )
        return
      }

      const transcriptPath = getTranscriptPath(cwd, sessionId)
      const cutoffTimestamp = m.lastActivityAt.toISOString()
      debugLog.event(
        `stdout_broken pid=${pid} alive=true — starting transcript fallback from ${cutoffTimestamp}`,
      )
      logger.warn(
        { issueId, executionId, pid, transcriptPath, cutoffTimestamp },
        'stdout_broken_transcript_fallback_starting',
      )
      emitDiagnosticLog(
        issueId,
        executionId,
        `[BKD] stdout pipe broke — falling back to transcript JSONL (pid=${pid})`,
        { event: 'stdout_broken_fallback', pid },
      )

      // Poll transcript JSONL until turn completion is detected or
      // the process exits.  The process may still be mid-turn (running
      // tool calls) when stdout breaks, so a single read is not enough.
      const POLL_INTERVAL_MS = 5_000
      const MAX_POLL_MS = 10 * 60_000 // 10 min safety cap
      const pollStart = Date.now()
      let lastCutoff = cutoffTimestamp

      const pollTimer = setInterval(() => {
        const current = ctx.pm.get(executionId)?.meta
        if (!current || current.turnSettled || current.state !== 'running') {
          clearInterval(pollTimer)
          return
        }

        // Safety: stop polling after MAX_POLL_MS to avoid infinite loop.
        // Clear stdoutBroken so stall detection can take over again.
        if (Date.now() - pollStart > MAX_POLL_MS) {
          clearInterval(pollTimer)
          current.stdoutBroken = false
          debugLog.event('transcript_fallback_timeout')
          logger.warn(
            { issueId, executionId },
            'transcript_fallback_poll_timeout',
          )
          return
        }

        const turnCompleted = runTranscriptFallback(
          transcriptPath,
          lastCutoff,
          logParser,
          (entry) => {
            const turnIdx = ctx.turnIndexes.get(executionId) ?? 0
            handleStreamEntry(issueId, executionId, {
              ...entry,
              turnIndex: turnIdx,
            })
            // Advance cutoff so next poll skips already-processed entries
            if (entry.timestamp) lastCutoff = entry.timestamp
          },
        )

        if (turnCompleted) {
          clearInterval(pollTimer)
          debugLog.event('transcript_fallback_turn_completed')
          logger.info(
            { issueId, executionId },
            'transcript_fallback_turn_completed',
          )
          onTurnCompleted()
        }
      }, POLL_INTERVAL_MS)
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
