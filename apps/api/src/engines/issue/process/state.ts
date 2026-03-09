import type { EngineContext } from '@/engines/issue/context'
import type { ManagedProcess } from '@/engines/issue/types'
import type { ProcessStatus } from '@/engines/types'

// ---------- Active process queries ----------

export function getActiveProcesses(ctx: EngineContext): ManagedProcess[] {
  return ctx.pm.getActive().map((e) => e.meta)
}

export function getActiveProcessForIssue(
  ctx: EngineContext,
  issueId: string,
): ManagedProcess | undefined {
  return ctx.pm.getFirstActiveInGroup(issueId)?.meta
}

// ---------- Domain data cleanup ----------

export function cleanupDomainData(ctx: EngineContext, executionId: string): void {
  ctx.entryCounters.delete(executionId)
  ctx.turnIndexes.delete(executionId)
}

/** Sync ProcessManager state with the domain state set by IssueEngine.
 *  PM's transitionState is idempotent, so double-sets are safe. */
export function syncPmState(ctx: EngineContext, executionId: string, state: ProcessStatus): void {
  if (state === 'completed') ctx.pm.markCompleted(executionId)
  else if (state === 'failed') ctx.pm.markFailed(executionId)
  // 'cancelled' is handled by pm.terminate() in cancel()
}
