import {
  collectPendingWithAttachments,
  markPendingMessagesDispatched,
} from '@/db/pending-messages'
import {
  autoMoveToReview,
  getIssueWithSession,
  updateIssueSession,
} from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled, emitStateChange } from '@/engines/issue/events'
import { dispatch } from '@/engines/issue/state'
import type { ManagedProcess } from '@/engines/issue/types'
import { sendInputToRunningProcess } from '@/engines/issue/user-message'
import type { ProcessStatus } from '@/engines/types'
import { logger } from '@/logger'

// ---------- Turn completion ----------

export function handleTurnCompleted(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed || managed.state !== 'running') return
  dispatch(managed, { type: 'TURN_COMPLETED' })
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

  // Track when the process became idle for idle timeout cleanup
  managed.lastIdleAt = new Date()

  const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
  emitStateChange(ctx, issueId, executionId, finalStatus as ProcessStatus)

  void (async () => {
    try {
      // Detect session ID error: the CLI couldn't find the session
      // (e.g. "No conversation found with session ID: xxx" after project
      // directory change).  Only reset externalSessionId when the error
      // specifically mentions the session, so other failures (API errors,
      // network issues, etc.) don't clear a valid session.
      const hasAssistantOutput = managed.logs
        .toArray()
        .some((l) => l.entryType === 'assistant-message')
      const reason = (managed.logicalFailureReason ?? '').toLowerCase()
      const isSessionError =
        finalStatus === 'failed' &&
        !hasAssistantOutput &&
        (reason.includes('no conversation found') || reason.includes('session'))
      if (isSessionError) {
        logger.warn(
          { issueId, executionId, reason: managed.logicalFailureReason },
          'session_id_error_resetting_session',
        )
        await updateIssueSession(issueId, {
          sessionStatus: finalStatus,
          externalSessionId: null,
        })
      } else {
        await updateIssueSession(issueId, { sessionStatus: finalStatus })
      }

      // Check for pending DB messages before moving to review.
      // If the user sent messages while the engine was busy, they were queued
      // as pending in the DB. Merge ALL pending messages (with attachments)
      // into a single follow-up prompt so the AI processes them in one turn.
      const { prompt: pendingPrompt, pendingIds } =
        await collectPendingWithAttachments(issueId)
      if (pendingIds.length > 0) {
        logger.info(
          { issueId, executionId, pendingCount: pendingIds.length },
          'auto_flush_pending_after_turn',
        )
        try {
          const issue = await getIssueWithSession(issueId)
          await ctx.followUpIssue?.(
            issueId,
            pendingPrompt,
            issue?.model ?? undefined,
          )
          await markPendingMessagesDispatched(pendingIds)
          return
        } catch (flushErr) {
          logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
          // Fall through to normal review flow
        }
      }

      // Guard: if a follow-up reactivated the issue while this async block
      // was running, the DB sessionStatus will no longer match finalStatus.
      // Emitting a stale settled event would cause the frontend to block
      // live log events for the new active execution.
      const freshIssue = await getIssueWithSession(issueId)
      if (
        freshIssue &&
        freshIssue.sessionFields.sessionStatus !== finalStatus
      ) {
        logger.debug(
          {
            issueId,
            executionId,
            finalStatus,
            currentStatus: freshIssue.sessionFields.sessionStatus,
          },
          'issue_turn_settle_skipped_reactivated',
        )
        return
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
  if (managed.pendingInputs.length === 0) return

  // Merge ALL queued inputs into a single message so the agent receives
  // one combined prompt instead of being sent messages one at a time.
  const all = managed.pendingInputs.splice(0)
  const mergedPrompt = all
    .map((i) => i.prompt)
    .filter(Boolean)
    .join('\n\n')
  // Use the latest model override (last wins)
  const lastModel = all.reduce<string | undefined>(
    (acc, i) => i.model ?? acc,
    undefined,
  )
  // Merge display prompts for the UI message bubble
  const mergedDisplay =
    all
      .map((i) => i.displayPrompt)
      .filter(Boolean)
      .join('\n\n') || undefined

  logger.debug(
    {
      issueId,
      executionId: managed.executionId,
      mergedCount: all.length,
      promptChars: mergedPrompt.length,
    },
    'issue_queue_flush_merged_inputs',
  )

  if (lastModel) {
    await updateIssueSession(issueId, { model: lastModel })
  }
  sendInputToRunningProcess(
    ctx,
    issueId,
    managed,
    mergedPrompt,
    mergedDisplay,
    all[all.length - 1]?.metadata,
  )
}
