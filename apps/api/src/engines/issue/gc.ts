import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import { logger } from '@/logger'
import { IDLE_TIMEOUT_MS } from './constants'
import type { EngineContext } from './context'
import { emitIssueSettled, emitStateChange } from './events'
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
          idleMinutes: Math.round(
            (now - managed.lastIdleAt.getTime()) / 60000,
          ),
        },
        'idle_timeout_terminate',
      )
      ctx.pm.forceKill(entry.id)
      emitStateChange(ctx, managed.issueId, managed.executionId, 'completed')
      cleanupDomainData(ctx, managed.executionId)
      // Fire-and-forget DB update
      void (async () => {
        try {
          await updateIssueSession(managed.issueId, {
            sessionStatus: 'completed',
          })
          await autoMoveToReview(managed.issueId)
          emitIssueSettled(
            ctx,
            managed.issueId,
            managed.executionId,
            'completed',
          )
        } catch (err) {
          logger.error(
            { issueId: managed.issueId, err },
            'idle_timeout_settle_failed',
          )
        }
      })()
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
