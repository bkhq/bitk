import {
  autoMoveToReview,
  getIssueWithSession,
  updateIssueSession,
} from '@/engines/engine-store'
import type { ProcessStatus } from '@/engines/types'
import { logger } from '@/logger'
import {
  IDLE_TIMEOUT_MS,
  STALL_PROBE_GRACE_MS,
  STREAM_STALL_TIMEOUT_MS,
} from './constants'
import type { EngineContext } from './context'
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
      const hasActiveProcess = ctx.pm
        .getActive()
        .some((e) => e.meta.issueId === issueId)
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
  const activeIssueIds = new Set(ctx.pm.getActive().map((e) => e.meta.issueId))
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
    // Two-tier approach to avoid killing legitimate long-running operations:
    //   Tier 1 (STREAM_STALL_TIMEOUT_MS): Send interrupt probe to check responsiveness
    //   Tier 2 (+ STALL_PROBE_GRACE_MS): No response after probe → force kill
    if (managed.turnInFlight) {
      const silenceMs = now - managed.lastActivityAt.getTime()

      // Tier 2: probe was sent but process still hasn't responded
      if (
        managed.stallProbeAt &&
        now - managed.stallProbeAt.getTime() > STALL_PROBE_GRACE_MS
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
        managed.stallProbeAt = undefined
        terminateAndSettle(ctx, entry.id, managed, 'failed')
        cleaned++
        continue
      }

      // Tier 1: no output for STREAM_STALL_TIMEOUT_MS — send interrupt probe
      if (!managed.stallProbeAt && silenceMs > STREAM_STALL_TIMEOUT_MS) {
        const stallMinutes = Math.round(silenceMs / 60000)
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
        // Send interrupt to probe process responsiveness. If the process is
        // alive (e.g. waiting on a slow API call), it will respond with an
        // error/result entry, which updates lastActivityAt and clears the stall.
        // Fire-and-forget: Tier 2 will force-kill if no response after grace period.
        try {
          managed.process.protocolHandler?.interrupt()
        } catch (err) {
          logger.warn(
            { issueId: managed.issueId, executionId: managed.executionId, err },
            'stall_probe_interrupt_failed',
          )
        }
      }
    }
  }

  if (cleaned > 0) {
    logger.debug(
      { cleaned, pmSize: ctx.pm.size(), pmActive: ctx.pm.activeCount() },
      'gc_sweep_completed',
    )
  }
}
