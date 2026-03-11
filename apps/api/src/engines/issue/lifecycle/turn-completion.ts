import { relocatePendingForProcessing, restorePendingVisibility } from '@/db/pending-messages'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled, emitStateChange } from '@/engines/issue/events'
import { dispatch } from '@/engines/issue/state'
import type { ManagedProcess } from '@/engines/issue/types'
import { sendInputToRunningProcess } from '@/engines/issue/user-message'
import type { ProcessStatus } from '@/engines/types'
import { emitIssueLogRemoved } from '@/events/issue-events'
import { logger } from '@/logger'

// Grace period before moving a conversational issue to 'review' after a turn
// completes. If the user sends a follow-up within this window, the
// START_TURN dispatch clears the settle timer and the issue stays in 'working'.
const SETTLE_GRACE_MS = 3_000

// ---------- Turn completion ----------

export function handleTurnCompleted(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed || managed.state !== 'running') return
  // Guard: if turnInFlight is already false, this is a duplicate turn-completion
  // entry from the stream (e.g. Claude emits a result entry followed by a system
  // stop entry, or the stream continues producing result entries after settlement).
  // Without this guard, each entry would trigger a new settlement cycle.
  if (!managed.turnInFlight) return
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
  // (which awaits subprocess.exited) will not fire yet.
  //
  // IMPORTANT: Do NOT change managed.state here. The subprocess is still alive
  // and can receive follow-up input. Keeping state as 'running' ensures
  // getActiveProcessForIssue() can find it, preventing duplicate process spawns.
  // The turnSettled flag tells monitorCompletion() to just clean up on exit.

  // Track when the process became idle for idle timeout cleanup
  managed.lastIdleAt = new Date()

  const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
  emitStateChange(issueId, executionId, finalStatus as ProcessStatus)

  // Phase 1: Immediately update sessionStatus + handle session errors + pending
  // DB messages. The statusId change (working → review) and the frontend
  // settlement event are deferred to Phase 2 so that follow-ups sent within
  // SETTLE_GRACE_MS keep the issue in 'working'.
  void (async () => {
    try {
      // Detect session ID error: the CLI couldn't find the session
      // (e.g. "No conversation found with session ID: xxx" after project
      // directory change).  Only reset externalSessionId when the error
      // specifically mentions the session, so other failures (API errors,
      // network issues, etc.) don't clear a valid session.
      const hasAssistantOutput = managed.logs
        .toArray()
        .some(l => l.entryType === 'assistant-message')
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
      // as pending in the DB. Relocate: hide old pending row, let follow-up
      // create a new entry at the current position in the conversation.
      const relocated = await relocatePendingForProcessing(issueId)
      if (relocated) {
        logger.info(
          { issueId, executionId, oldPendingId: relocated.oldId },
          'auto_flush_pending_after_turn',
        )
        try {
          const issue = await getIssueWithSession(issueId)
          await ctx.followUpIssue?.(
            issueId,
            relocated.prompt,
            issue?.model ?? undefined,
            undefined, // permissionMode
            undefined, // busyAction
            relocated.displayPrompt,
            relocated.metadata,
          )
          // Notify frontend to remove the old pending entry
          emitIssueLogRemoved(issueId, [relocated.oldId])
          logger.debug({ issueId, executionId }, 'turn_deferred_to_followup')
          return
        } catch (flushErr) {
          logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
          restorePendingVisibility(relocated.oldId)
          // Fall through to normal review flow
        }
      }

      // Phase 2: Move to review.
      // If the process already exited (non-conversational engines like echo
      // or claude-code one-shot), settle immediately — the grace period is
      // only useful while the process is still alive and can accept follow-ups.
      if (managed.exitCode !== undefined) {
        await settleAfterGrace(ctx, issueId, executionId, managed, finalStatus)
      } else {
        // Process still alive — schedule delayed settle. If the user sends a
        // follow-up within SETTLE_GRACE_MS, the START_TURN dispatch clears
        // this timer and the issue stays in 'working'.
        if (managed.settleTimer) clearTimeout(managed.settleTimer)
        managed.settleTimer = setTimeout(() => {
          managed.settleTimer = undefined
          void settleAfterGrace(ctx, issueId, executionId, managed, finalStatus)
        }, SETTLE_GRACE_MS)
      }
    } catch (error) {
      // Cancel any pending delayed settle — the fallback below will handle it.
      if (managed.settleTimer) {
        clearTimeout(managed.settleTimer)
        managed.settleTimer = undefined
      }
      logger.error({ issueId, executionId, error }, 'issue_turn_settle_failed')
      // Safety net: ensure frontend is always notified even if settlement
      // partially failed. Without this, the frontend never receives the
      // 'done' SSE event and stays stuck in "thinking" state indefinitely
      // (terminal states are filtered from the 'state' subscriber).
      //
      // Guard: skip if a follow-up has reactivated the issue.
      // Check for a DIFFERENT active PM process for this issue (not our own
      // executionId). Also check if DB status already diverged to a terminal
      // state we didn't set.
      try {
        const freshIssue = await getIssueWithSession(issueId)
        const currentStatus = freshIssue?.sessionFields.sessionStatus
        const hasOtherActive = ctx.pm
          .getActive()
          .some(e => e.meta.issueId === issueId && e.id !== executionId)
        if (
          hasOtherActive ||
          (currentStatus !== finalStatus &&
            currentStatus !== 'running' &&
            currentStatus !== 'pending')
        ) {
          logger.debug(
            {
              issueId,
              executionId,
              finalStatus,
              currentStatus,
              hasOtherActive,
            },
            'issue_turn_settle_catch_skipped_reactivated',
          )
          return
        }
        await updateIssueSession(issueId, { sessionStatus: finalStatus })
      } catch (innerErr) {
        logger.error({ issueId, executionId, err: innerErr }, 'issue_turn_settle_catch_db_failed')
      }
      emitIssueSettled(issueId, executionId, finalStatus)
    }
  })()
}

/**
 * Phase 2 of turn settlement: runs after SETTLE_GRACE_MS.
 * Moves the issue to 'review' and emits the settled event, unless a new
 * turn started during the grace period (turnSettled would be false).
 */
async function settleAfterGrace(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  managed: ManagedProcess,
  finalStatus: string,
): Promise<void> {
  try {
    // Guard: if a new turn started during the grace period, skip
    if (!managed.turnSettled) {
      logger.debug({ issueId, executionId }, 'issue_turn_settle_cancelled_new_turn')
      return
    }

    // Guard: if a follow-up reactivated the issue while we waited, the DB
    // sessionStatus will no longer match finalStatus.
    const freshIssue = await getIssueWithSession(issueId)
    if (freshIssue && freshIssue.sessionFields.sessionStatus !== finalStatus) {
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
    emitIssueSettled(issueId, executionId, finalStatus)
    logger.info({ issueId, executionId, finalStatus }, 'issue_turn_settled')
  } catch (err) {
    logger.error({ issueId, executionId, err }, 'issue_turn_delayed_settle_failed')
    // Safety net: always notify frontend even on error
    if (managed.turnSettled) {
      emitIssueSettled(issueId, executionId, finalStatus)
    }
  }
}

/**
 * Flush a pending settle timer immediately (e.g. when the process exits).
 * This avoids waiting the full SETTLE_GRACE_MS for engines where the process
 * exits after each turn — the grace period is only useful while the process
 * is still alive and can receive follow-up input.
 */
export function flushSettleTimer(
  ctx: EngineContext,
  managed: ManagedProcess,
): void {
  if (!managed.settleTimer) return
  clearTimeout(managed.settleTimer)
  managed.settleTimer = undefined
  void settleAfterGrace(ctx, managed.issueId, managed.executionId, managed, managed.logicalFailure ? 'failed' : 'completed')
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
  // Snapshot the array instead of splicing — if sendInputToRunningProcess
  // throws, the messages remain in pendingInputs for the next flush attempt.
  const all = [...managed.pendingInputs]
  const mergedPrompt = all
    .map(i => i.prompt)
    .filter(Boolean)
    .join('\n\n')
  // Use the latest model override (last wins)
  const lastModel = all.reduce<string | undefined>((acc, i) => i.model ?? acc, undefined)
  // Merge display prompts for the UI message bubble
  const mergedDisplay =
    all
      .map(i => i.displayPrompt)
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
  try {
    sendInputToRunningProcess(
      ctx,
      issueId,
      managed,
      mergedPrompt,
      mergedDisplay,
      all.at(-1)?.metadata,
    )
    // Remove only the consumed messages — new inputs queued during the
    // await above are preserved for the next flush cycle.
    dispatch(managed, { type: 'SPLICE_PENDING_INPUTS', count: all.length })
  } catch (err) {
    // Messages preserved in managed.pendingInputs for next flush attempt
    logger.error(
      { issueId, executionId: managed.executionId, err },
      'flush_queued_inputs_send_failed',
    )
    throw err
  }
}
