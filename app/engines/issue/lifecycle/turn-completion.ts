import type { ProcessStatus } from '../../types'
import type { EngineContext } from '../context'
import type { ManagedProcess } from '../types'
import { getPendingMessages, markPendingMessagesDispatched } from '../../../db/pending-messages'
import { logger } from '../../../logger'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '../../engine-store'
import { emitIssueSettled, emitStateChange } from '../events'
import { sendInputToRunningProcess } from '../user-message'

// ---------- Turn completion ----------

export function handleTurnCompleted(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed || managed.state !== 'running') return
  managed.turnInFlight = false
  managed.queueCancelRequested = false
  managed.metaTurn = false
  logger.debug(
    { issueId, executionId, queued: managed.pendingInputs.length },
    'issue_turn_completed',
  )

  if (managed.pendingInputs.length > 0) {
    void flushQueuedInputs(ctx, issueId, managed)
    return
  }

  // No queued inputs — the AI turn is done and the process is idle.
  // For conversational engines the subprocess stays alive, so monitorCompletion
  // (which awaits subprocess.exited) will not fire yet. Settle the issue now:
  // update DB session status and auto-move to review.
  //
  // IMPORTANT: Do NOT change managed.state here. The subprocess is still alive
  // and can receive follow-up input. Keeping state as 'running' ensures
  // getActiveProcessForIssue() can find it, preventing duplicate process spawns.
  // The turnSettled flag tells monitorCompletion() to just clean up on exit.
  const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
  managed.turnSettled = true
  emitStateChange(ctx, issueId, executionId, finalStatus as ProcessStatus)

  void (async () => {
    try {
      await updateIssueSession(issueId, { sessionStatus: finalStatus })

      // Check for pending DB messages before moving to review.
      // If the user sent messages while the engine was busy, they were queued
      // as pending in the DB. Auto-flush them as a follow-up instead of
      // moving the issue to review, so the AI processes them in a fresh turn.
      const pendingRows = await getPendingMessages(issueId)
      if (pendingRows.length > 0) {
        logger.info(
          { issueId, executionId, pendingCount: pendingRows.length },
          'auto_flush_pending_after_turn',
        )
        const prompt = pendingRows
          .map((r) => r.content)
          .filter(Boolean)
          .join('\n\n')
        const pendingIds = pendingRows.map((r) => r.id)
        try {
          const issue = await getIssueWithSession(issueId)
          await ctx.followUpIssue(issueId, prompt, issue?.model ?? undefined)
          await markPendingMessagesDispatched(pendingIds)
          return
        } catch (flushErr) {
          logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
          // Fall through to normal review flow
        }
      }

      await autoMoveToReview(issueId)
      emitIssueSettled(ctx, issueId, executionId, finalStatus)
      logger.info({ issueId, executionId, finalStatus }, 'issue_turn_settled')
    } catch (error) {
      logger.error({ issueId, executionId, error }, 'issue_turn_settle_failed')
    }
  })()
}

export async function flushQueuedInputs(
  ctx: EngineContext,
  issueId: string,
  managed: ManagedProcess,
): Promise<void> {
  if (managed.state !== 'running' || managed.turnInFlight) return
  const next = managed.pendingInputs.shift()
  if (!next) return
  logger.debug(
    {
      issueId,
      executionId: managed.executionId,
      remainingQueue: managed.pendingInputs.length,
      promptChars: next.prompt.length,
    },
    'issue_queue_flush_next_input',
  )

  if (next.model) {
    await updateIssueSession(issueId, { model: next.model })
  }
  sendInputToRunningProcess(ctx, issueId, managed, next.prompt, next.displayPrompt, next.metadata)
}
