import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog } from '@/engines/issue/diagnostic'
import { emitIssueSettled } from '@/engines/issue/events'
import { cleanupDomainData } from '@/engines/issue/process/state'
import { logger } from '@/logger'

/**
 * Common settle flow: persist status, auto-move, clean domain data, emit event.
 *
 * NOTE: Worktree cleanup is NOT done here. Worktrees are preserved across
 * completed/failed settlements so follow-ups can reuse them. Cleanup is
 * handled by the periodic background job in jobs/worktree-cleanup.ts.
 *
 * IMPORTANT: emitIssueSettled() MUST always fire — the SSE route filters
 * terminal states from the 'state' subscriber and only sends them via the
 * 'done' subscriber. If emitIssueSettled is skipped, the frontend never
 * receives a terminal event and stays stuck in "thinking" state forever.
 */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  try {
    await updateIssueSession(issueId, { sessionStatus: status })
    await autoMoveToReview(issueId)
  } catch (err) {
    logger.error({ issueId, executionId, status, err }, 'settle_issue_partial_failure')
  } finally {
    cleanupDomainData(ctx, executionId)
    emitDiagnosticLog(issueId, executionId, `[BKD] Issue settled (status=${status})`, {
      event: 'issue_settled',
      status,
    })
    emitIssueSettled(issueId, executionId, status)
  }
}
