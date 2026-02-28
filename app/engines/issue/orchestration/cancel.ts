import type { EngineContext } from '../context'
import { logger } from '../../../logger'
import { updateIssueSession } from '../../engine-store'
import { cancel } from '../process/cancel'
import { withIssueLock } from '../process/lock'
import { getActiveProcesses } from '../process/state'
import { dispatch } from '../state'
import { getPidFromManaged } from '../utils/pid'

export async function cancelIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<'interrupted' | 'cancelled'> {
  return withIssueLock(ctx, issueId, async () => {
    logger.info({ issueId }, 'issue_cancel_requested')
    const active = getActiveProcesses(ctx).filter((p) => p.issueId === issueId)
    for (const p of active) {
      logger.debug(
        { issueId, executionId: p.executionId, pid: getPidFromManaged(p) },
        'issue_cancel_active_process',
      )
      dispatch(p, { type: 'CLEAR_PENDING_INPUTS' })
      p.queueCancelRequested = false
      await cancel(ctx, p.executionId, { emitCancelledState: false, hard: false })
    }
    if (active.length > 0) {
      // Persist cancelled immediately so process restarts/stale cleanup
      // cannot flip this user-initiated cancel into failed.
      await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
      logger.info({ issueId, interruptedCount: active.length }, 'issue_cancel_soft_interrupted')
      return 'interrupted'
    }
    await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
    logger.info({ issueId, cancelledCount: 0 }, 'issue_cancel_completed')
    return 'cancelled'
  })
}
