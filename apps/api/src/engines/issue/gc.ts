import {
  autoMoveToReview,
  getIssueWithSession,
  updateIssueSession,
} from '@/engines/engine-store'
import { logger } from '@/logger'
import { IDLE_TIMEOUT_MS } from './constants'
import type { EngineContext } from './context'
import { emitIssueSettled, emitStateChange } from './events'
import { withIssueLock } from './process/lock'
import { cleanupDomainData } from './process/state'

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
      ctx.pm.forceKill(entry.id)
      cleanupDomainData(ctx, managed.executionId)
      // Fire-and-forget DB update — use issue lock to prevent racing with follow-up
      const { issueId: gcIssueId, executionId: gcExecutionId } = managed
      void withIssueLock(ctx, gcIssueId, async () => {
        const existing = await getIssueWithSession(gcIssueId)
        const priorStatus = existing?.sessionFields.sessionStatus
        // If a follow-up already reactivated the issue, skip settlement
        if (priorStatus === 'running' || priorStatus === 'pending') {
          logger.debug(
            { issueId: gcIssueId, priorStatus },
            'idle_timeout_settle_skipped_reactivated',
          )
          return
        }
        const isTerminal =
          priorStatus === 'failed' || priorStatus === 'cancelled'
        const finalStatus = isTerminal ? priorStatus : 'completed'
        emitStateChange(gcIssueId, gcExecutionId, finalStatus)
        if (!isTerminal) {
          await updateIssueSession(gcIssueId, {
            sessionStatus: finalStatus,
          })
        }
        await autoMoveToReview(gcIssueId)
        emitIssueSettled(gcIssueId, gcExecutionId, finalStatus)
      }).catch((err) => {
        logger.error({ issueId: gcIssueId, err }, 'idle_timeout_settle_failed')
      })
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
