import type { EngineContext } from '../context'
import { autoMoveToReview, updateIssueSession } from '../../engine-store'
import { emitIssueSettled } from '../events'
import { cleanupDomainData } from '../process/state'

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
