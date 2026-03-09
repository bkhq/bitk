import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled, emitStateChange } from '@/engines/issue/events'
import { withIssueLock } from '@/engines/issue/process/lock'
import { cleanupDomainData } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'

// ---------- Cancel ----------

export async function cancel(
  ctx: EngineContext,
  executionId: string,
  opts: { emitCancelledState?: boolean; hard?: boolean } = {},
): Promise<void> {
  const entry = ctx.pm.get(executionId)
  if (!entry) return
  const managed = entry.meta
  if (entry.state !== 'running') return

  logger.debug(
    {
      issueId: managed.issueId,
      executionId,
      pid: getPidFromManaged(managed),
      emitCancelledState: opts.emitCancelledState !== false,
      hard: opts.hard === true,
    },
    'issue_process_cancel_start',
  )

  managed.process.cancel()

  // Soft cancel: interrupt current turn only and keep process alive.
  if (!opts.hard) {
    managed.lastInterruptAt = new Date()
    logger.debug(
      {
        issueId: managed.issueId,
        executionId,
        pid: getPidFromManaged(managed),
      },
      'issue_process_interrupt_sent',
    )
    return
  }

  // Hard cancel: delegate kill timeout to PM (PM.terminate handles state transition)
  if (opts.emitCancelledState !== false) {
    emitStateChange(managed.issueId, executionId, 'cancelled')
  }

  await ctx.pm.terminate(executionId, () => managed.process.cancel())
  dispatch(managed, { type: 'MARK_CANCELLED' })
  logger.debug(
    { issueId: managed.issueId, executionId, pid: getPidFromManaged(managed) },
    'issue_process_cancel_finished',
  )
}

// ---------- Force terminate ----------

/**
 * Force-terminate a process regardless of its current state.
 * Works on running, spawning, completed, failed, or cancelled processes.
 * Updates DB session status and moves the issue to review.
 */
export async function terminateProcess(ctx: EngineContext, issueId: string): Promise<void> {
  return withIssueLock(ctx, issueId, async () => {
    // Kill active processes (spawning or running)
    const active = ctx.pm.getActiveInGroup(issueId)
    let lastExecutionId = ''
    for (const entry of active) {
      const managed = entry.meta
      logger.info(
        {
          issueId,
          executionId: entry.id,
          pid: getPidFromManaged(managed),
          state: entry.state,
        },
        'force_terminate_active_process',
      )
      dispatch(managed, { type: 'CLEAR_PENDING_INPUTS' })
      dispatch(managed, { type: 'MARK_CANCELLED' })
      emitStateChange(issueId, entry.id, 'cancelled')
      ctx.pm.forceKill(entry.id)
      cleanupDomainData(ctx, entry.id)
      lastExecutionId = entry.id
    }

    await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
    await autoMoveToReview(issueId)
    emitIssueSettled(issueId, lastExecutionId, 'cancelled')
    logger.info({ issueId }, 'force_terminate_completed')
  })
}
