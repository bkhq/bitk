import type { EngineContext } from './context'
import { logger } from '../../logger'
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
  if (cleaned > 0) {
    logger.debug(
      { cleaned, pmSize: ctx.pm.size(), pmActive: ctx.pm.activeCount() },
      'gc_sweep_completed',
    )
  }
}
