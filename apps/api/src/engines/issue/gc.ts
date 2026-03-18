import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import type { ProcessStatus } from '@/engines/types'
import { logger } from '@/logger'
import {
  IDLE_TIMEOUT_MS,
  STALL_INTERRUPT_GRACE_MS,
  STALL_LIVENESS_GRACE_MS,
  STREAM_STALL_TIMEOUT_MS,
} from './constants'
import type { EngineContext } from './context'
import { emitDiagnosticLog } from './diagnostic'
import { emitIssueSettled, emitStateChange } from './events'
import { withIssueLock } from './process/lock'
import { cleanupDomainData, syncPmState } from './process/state'
import type { ManagedProcess } from './types'

// ---------- Helpers ----------

function terminateAndSettle(
  ctx: EngineContext,
  pmEntryId: string,
  managed: ManagedProcess,
  defaultStatus: ProcessStatus,
): void {
  ctx.pm.forceKill(pmEntryId)
  // forceKill transitions PM state to 'cancelled'. Override to the intended
  // status so monitorCompletion (racing on subprocess.exited) sees 'failed'
  // instead of 'cancelled' for stalled processes.
  syncPmState(ctx, managed.executionId, defaultStatus)
  cleanupDomainData(ctx, managed.executionId)
  const { issueId, executionId } = managed
  // Track the resolved status so the catch block can use it instead of
  // falling back to defaultStatus (which may differ from the actual
  // terminal status computed inside the lock).
  let resolvedStatus: string = defaultStatus
  void withIssueLock(ctx, issueId, async () => {
    const existing = await getIssueWithSession(issueId)
    const priorStatus = existing?.sessionFields.sessionStatus
    // Only skip if a follow-up has truly reactivated the issue (a newer
    // process is now running). We just force-killed this process, so if
    // DB still shows running/pending but no other active process exists,
    // the status is stale from the process we killed — settle it.
    if (priorStatus === 'running' || priorStatus === 'pending') {
      const hasActiveProcess = ctx.pm.getActive().some(e => e.meta.issueId === issueId)
      if (hasActiveProcess) {
        logger.debug({ issueId, priorStatus }, 'gc_settle_skipped_reactivated')
        return
      }
    }
    const isTerminal = priorStatus === 'failed' || priorStatus === 'cancelled'
    const finalStatus = isTerminal ? priorStatus : defaultStatus
    resolvedStatus = finalStatus
    syncPmState(ctx, executionId, finalStatus as ProcessStatus)
    emitStateChange(issueId, executionId, finalStatus)
    if (!isTerminal) {
      await updateIssueSession(issueId, { sessionStatus: finalStatus })
    }
    try {
      await autoMoveToReview(issueId)
    } catch (err) {
      logger.error({ issueId, err }, 'gc_auto_move_failed')
    }
    emitIssueSettled(issueId, executionId, finalStatus)
  }).catch((err) => {
    logger.error({ issueId, err }, 'gc_settle_failed')
    // Safety net: ensure frontend is always notified even if settlement
    // partially failed. Use resolvedStatus (which may have been updated
    // inside the lock) rather than defaultStatus to avoid status mismatch.
    emitIssueSettled(issueId, executionId, resolvedStatus)
  })
}

/** Check if a process is still alive via kill(pid, 0). */
function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------- Domain GC sweep ----------

export function gcSweep(ctx: EngineContext): void {
  let cleaned = 0
  // Clean orphaned entryCounters/turnIndexes for entries no longer in PM
  for (const executionId of ctx.entryCounters.keys()) {
    if (!ctx.pm.has(executionId)) {
      cleanupDomainData(ctx, executionId)
      cleaned++
    }
  }
  // Note: issueOpLocks are NOT GC'd here — withIssueLock() self-cleans in its
  // finally block. Deleting them externally would break the per-issue mutex.
  // Clean orphaned userMessageIds entries for issues no longer tracked
  const activeIssueIds = new Set(ctx.pm.getActive().map(e => e.meta.issueId))
  for (const key of ctx.userMessageIds.keys()) {
    const issueId = key.split(':')[0] ?? key
    if (!activeIssueIds.has(issueId)) {
      ctx.userMessageIds.delete(key)
      cleaned++
    }
  }

  // Terminate idle processes that have exceeded the idle timeout.
  // Note: getActive() returns a snapshot array, so forceKill() inside
  // terminateAndSettle() does not mutate the collection we're iterating.
  const now = Date.now()
  for (const entry of ctx.pm.getActive()) {
    try {
      const managed = entry.meta

      // --- Check 1: Idle timeout (turn completed, process still alive) ---
      if (
        managed.lastIdleAt &&
        !managed.turnInFlight &&
        now - managed.lastIdleAt.getTime() > IDLE_TIMEOUT_MS
      ) {
        logger.info(
          {
            issueId: managed.issueId,
            executionId: managed.executionId,
            idleMinutes: Math.round((now - managed.lastIdleAt.getTime()) / 60000),
          },
          'idle_timeout_terminate',
        )
        terminateAndSettle(ctx, entry.id, managed, 'completed')
        cleaned++
        continue
      }

      // --- Check 2: Stream stall detection (turn in-flight but no output) ---
      // Three-tier approach: give the CLI time to retry internally before we intervene.
      //   Tier 1 (STREAM_STALL_TIMEOUT_MS): Non-destructive liveness check via OS
      //   Tier 2 (+ STALL_LIVENESS_GRACE_MS): Process alive but still silent → send interrupt
      //   Tier 3 (+ STALL_INTERRUPT_GRACE_MS): No response after interrupt → force kill
      if (managed.turnInFlight) {
        const silenceMs = now - managed.lastActivityAt.getTime()
        const pid = (managed.process.subprocess as { pid?: number }).pid

        // Tier 3: interrupt was sent but process still hasn't responded
        if (
          managed.stallProbeAt &&
          now - managed.stallProbeAt.getTime() > STALL_INTERRUPT_GRACE_MS
        ) {
          const stallMinutes = Math.round(silenceMs / 60000)
          logger.warn(
            {
              issueId: managed.issueId,
              executionId: managed.executionId,
              stallMinutes,
              lastActivityAt: managed.lastActivityAt.toISOString(),
              probeSentAt: managed.stallProbeAt.toISOString(),
            },
            'stream_stall_terminate',
          )
          managed.stallDetectedAt = undefined
          managed.stallProbeAt = undefined
          managed.debugLog?.event(
            `stall_force_kill silent=${stallMinutes}min pid=${pid} lastActivity=${managed.lastActivityAt.toISOString()}`,
          )
          emitDiagnosticLog(
            managed.issueId,
            managed.executionId,
            `[BKD] Stream stall force kill — no response after interrupt (silent ${stallMinutes}min, pid=${pid})`,
            { event: 'stall_force_kill', stallMinutes, pid },
          )
          terminateAndSettle(ctx, entry.id, managed, 'failed')
          cleaned++
          continue
        }

        // Tier 2: stall detected for STALL_LIVENESS_GRACE_MS, process still alive → send interrupt
        if (
          managed.stallDetectedAt &&
          !managed.stallProbeAt &&
          now - managed.stallDetectedAt.getTime() > STALL_LIVENESS_GRACE_MS
        ) {
          const stallMinutes = Math.round(silenceMs / 60000)
          const alive = isProcessAlive(pid)
          if (!alive) {
            // Process already dead — skip interrupt, just terminate
            logger.warn(
              {
                issueId: managed.issueId,
                executionId: managed.executionId,
                stallMinutes,
                pid,
              },
              'stream_stall_process_dead',
            )
            managed.stallDetectedAt = undefined
            terminateAndSettle(ctx, entry.id, managed, 'failed')
            cleaned++
            continue
          }
          logger.warn(
            {
              issueId: managed.issueId,
              executionId: managed.executionId,
              stallMinutes,
              lastActivityAt: managed.lastActivityAt.toISOString(),
            },
            'stream_stall_probe_sent',
          )
          managed.stallProbeAt = new Date()
          managed.debugLog?.event(`stall_probe silent=${stallMinutes}min pid=${pid} alive=true`)
          emitDiagnosticLog(
            managed.issueId,
            managed.executionId,
            `[BKD] Stream stall — sending interrupt probe (silent ${stallMinutes}min, pid=${pid})`,
            { event: 'stall_probe', stallMinutes, pid },
          )
          // Send interrupt to probe process responsiveness. The CLI had
          // STALL_LIVENESS_GRACE_MS to recover on its own — now we intervene.
          // Fire-and-forget: use Promise.resolve() to normalize void | Promise<void>
          // since Codex's implementation is genuinely async while Claude's is sync.
          void Promise.resolve(managed.process.protocolHandler?.interrupt()).catch(
            (err: unknown) => {
              logger.warn(
                {
                  issueId: managed.issueId,
                  executionId: managed.executionId,
                  err,
                },
                'stall_probe_interrupt_failed',
              )
            },
          )
          continue
        }

        // Tier 1: no output for STREAM_STALL_TIMEOUT_MS — non-destructive liveness check
        if (
          !managed.stallDetectedAt &&
          !managed.stallProbeAt &&
          silenceMs > STREAM_STALL_TIMEOUT_MS
        ) {
          const alive = isProcessAlive(pid)
          const stallMinutes = Math.round(silenceMs / 60000)
          logger.warn(
            {
              issueId: managed.issueId,
              executionId: managed.executionId,
              stallMinutes,
              lastActivityAt: managed.lastActivityAt.toISOString(),
              pid,
              processAlive: alive,
            },
            'stream_stall_detected',
          )
          if (!alive) {
            // Process already dead — terminate immediately
            emitDiagnosticLog(
              managed.issueId,
              managed.executionId,
              `[BKD] Stream stall — process already dead (silent ${stallMinutes}min, pid=${pid})`,
              { event: 'stall_process_dead', stallMinutes, pid },
            )
            terminateAndSettle(ctx, entry.id, managed, 'failed')
            cleaned++
            continue
          }
          // Process is alive — likely retrying API connection internally.
          // Mark stall detected and give CLI time to recover on its own.
          managed.stallDetectedAt = new Date()
          managed.debugLog?.event(`stall_detected silent=${stallMinutes}min pid=${pid} alive=true`)
          emitDiagnosticLog(
            managed.issueId,
            managed.executionId,
            `[BKD] Stream stall detected — waiting for CLI recovery (silent ${stallMinutes}min, pid=${pid})`,
            { event: 'stall_detected', stallMinutes, pid },
          )
        }
      }
    } catch (err) {
      logger.error({ entryId: entry.id, issueId: entry.meta?.issueId, err }, 'gc_sweep_entry_error')
    }
  }

  if (cleaned > 0) {
    logger.debug(
      { cleaned, pmSize: ctx.pm.size(), pmActive: ctx.pm.activeCount() },
      'gc_sweep_completed',
    )
  }
}
