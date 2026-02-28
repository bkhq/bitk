import type { EngineContext } from '@/engines/issue/context'
import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import { emitIssueSettled } from '@/engines/issue/events'
import { cleanupDomainData } from '@/engines/issue/process/state'

/** Common settle flow: persist status, auto-move, clean domain data, emit event. */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  await updateIssueSession(issueId, { sessionStatus: status })
  await autoMoveToReview(issueId)
  cleanupDomainData(ctx, executionId)
  emitIssueSettled(ctx, issueId, executionId, status)
}
