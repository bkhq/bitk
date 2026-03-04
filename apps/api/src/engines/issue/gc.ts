import {
  autoMoveToReview,
  getIssueWithSession,
  updateIssueSession,
} from '@/engines/engine-store'
import { logger } from '@/logger'
import type { ProcessStatus } from '@/engines/types'
import { IDLE_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from './constants'
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
  cleanupDomainData(ctx, managed.executionId)
  const { issueId, executionId } = managed
  void withIssueLock(ctx, issueId, async () => {
    const existing = await getIssueWithSession(issueId)
    const priorStatus = existing?.sessionFields.sessionStatus
    if (priorStatus === 'running' || priorStatus === 'pending') {
      logger.debug(
        { issueId, priorStatus },
        'gc_settle_skipped_reactivated',
      )
      return
    }
    const isTerminal = priorStatus === 'failed' || priorStatus === 'cancelled'
    const finalStatus = isTerminal ? priorStatus : defaultStatus
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
    // partially failed. Without this, the frontend stays stuck in "thinking".
    emitIssueSettled(issueId, executionId, defaultStatus)
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

  // Terminate idle processes that have exceeded the idle timeout
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
    // Catches processes stuck in "thinking" state where the engine never emits
    // a completion entry: turnInFlight stays true, lastIdleAt is never set,
    // and monitorCompletion() waits forever on subprocess.exited.
    if (
      managed.turnInFlight &&
      now - managed.lastActivityAt.getTime() > STREAM_STALL_TIMEOUT_MS
    ) {
      const stallMinutes = Math.round(
        (now - managed.lastActivityAt.getTime()) / 60000,
      )
      logger.warn(
        {
          issueId: managed.issueId,
          executionId: managed.executionId,
          stallMinutes,
          lastActivityAt: managed.lastActivityAt.toISOString(),
        },
        'stream_stall_terminate',
      )
      terminateAndSettle(ctx, entry.id, managed, 'failed')
      cleaned++
    }
  }

  if (cleaned > 0) {
    logger.debug(
      { cleaned, pmSize: ctx.pm.size(), pmActive: ctx.pm.activeCount() },
      'gc_sweep_completed',
    )
  }
}
