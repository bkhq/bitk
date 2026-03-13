import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { CANCEL_MAX_RETRIES, CANCEL_RESPONSE_TIMEOUT_MS } from '@/engines/issue/constants'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled } from '@/engines/issue/events'
import { cancel } from '@/engines/issue/process/cancel'
import { withIssueLock } from '@/engines/issue/process/lock'
import { getActiveProcesses } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import type { ManagedProcess } from '@/engines/issue/types'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'

/**
 * Wait for the process to settle (turnSettled or terminal state).
 * Returns true if settled, false if timed out.
 */
function waitForSettlement(managed: ManagedProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = setInterval(() => {
      if (
        managed.turnSettled ||
        managed.state === 'completed' ||
        managed.state === 'failed' ||
        managed.state === 'cancelled'
      ) {
        clearInterval(check)
        resolve(true)
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(check)
        resolve(false)
      }
    }, 200)
  })
}

/**
 * Check whether the escalation is still valid.
 * Returns true (stale) if:
 * - A new turn has started (cancelEscalationId was cleared by START_TURN)
 * - The process was removed from PM
 * - The process already reached a terminal state
 */
function isEscalationStale(
  ctx: EngineContext,
  managed: ManagedProcess,
  escalationId: string,
): boolean {
  // A new turn started — follow-up reactivated the process
  if (managed.cancelEscalationId !== escalationId) return true
  // PM entry removed by cleanup
  if (!ctx.pm.get(managed.executionId)) return true
  // Already terminal
  if (
    managed.state === 'completed' ||
    managed.state === 'failed' ||
    managed.state === 'cancelled'
  ) {
    return true
  }
  return false
}

/**
 * Escalate cancel: retry interrupts, then hard kill.
 * Runs OUTSIDE the issue lock to avoid blocking other operations.
 *
 * Uses `cancelEscalationId` to detect if a follow-up has reactivated the
 * process between retries. START_TURN clears `cancelEscalationId`, which
 * makes this escalation abort instead of killing a legitimate turn.
 */
async function escalateCancel(
  ctx: EngineContext,
  issueId: string,
  processes: Array<{ managed: ManagedProcess, escalationId: string }>,
): Promise<void> {
  for (const { managed, escalationId } of processes) {
    const { executionId } = managed
    const pid = getPidFromManaged(managed)

    // Phase 1: Wait for initial interrupt, then retry with additional interrupts.
    // The first interrupt was already sent by cancelIssue(), so attempt=1 only
    // waits for settlement. Subsequent attempts send a new interrupt before waiting.
    let settled = false
    for (let attempt = 1; attempt <= CANCEL_MAX_RETRIES; attempt++) {
      // Check if escalation is stale (settled, removed, or reactivated by follow-up)
      if (isEscalationStale(ctx, managed, escalationId)) {
        logger.info(
          { issueId, executionId, pid, attempt, escalationId },
          'cancel_escalation_stale_aborting',
        )
        settled = true
        break
      }

      // Send additional interrupt on retry attempts (attempt > 1).
      // Attempt 1 waits for the initial interrupt sent by cancelIssue().
      if (attempt > 1) {
        logger.info(
          {
            issueId,
            executionId,
            pid,
            attempt,
            maxRetries: CANCEL_MAX_RETRIES,
          },
          'cancel_escalation_retry_interrupt',
        )
        try {
          managed.process.cancel()
        } catch (err) {
          logger.warn({ issueId, executionId, err }, 'cancel_escalation_interrupt_failed')
        }
      }

      // Wait for response
      settled = await waitForSettlement(managed, CANCEL_RESPONSE_TIMEOUT_MS)
      if (settled) {
        logger.info({ issueId, executionId, pid, attempt }, 'cancel_escalation_settled_after_retry')
        break
      }
    }

    // Phase 2: Hard kill if still not settled
    if (!settled) {
      // Final staleness check before hard kill
      if (isEscalationStale(ctx, managed, escalationId)) {
        logger.info(
          { issueId, executionId, pid, escalationId },
          'cancel_escalation_stale_before_hard_kill',
        )
        continue
      }

      const totalWaitMs = CANCEL_MAX_RETRIES * CANCEL_RESPONSE_TIMEOUT_MS
      logger.warn(
        {
          issueId,
          executionId,
          pid,
          retries: CANCEL_MAX_RETRIES,
          totalWaitMs,
        },
        'cancel_escalation_hard_kill',
      )

      await withIssueLock(ctx, issueId, async () => {
        // Re-check inside lock — conditions may have changed
        if (isEscalationStale(ctx, managed, escalationId)) return
        await cancel(ctx, executionId, {
          emitCancelledState: true,
          hard: true,
        })
        logger.info({ issueId, executionId, pid }, 'cancel_escalation_hard_kill_sent')
      })
    }
  }
}

export async function cancelIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<'interrupted' | 'cancelled'> {
  // Collect processes and send first interrupt inside the lock
  const processesToEscalate: Array<{
    managed: ManagedProcess
    escalationId: string
  }> = []

  const result = await withIssueLock(ctx, issueId, async () => {
    logger.info({ issueId }, 'issue_cancel_requested')
    const active = getActiveProcesses(ctx).filter(p => p.issueId === issueId)
    for (const p of active) {
      logger.debug(
        { issueId, executionId: p.executionId, pid: getPidFromManaged(p) },
        'issue_cancel_active_process',
      )
      dispatch(p, { type: 'CLEAR_PENDING_INPUTS' })
      p.queueCancelRequested = false

      // Tag the process with a unique escalation ID so the async escalation
      // can detect if a follow-up reactivated the process (START_TURN clears it).
      const escalationId = crypto.randomUUID()
      p.cancelEscalationId = escalationId

      await cancel(ctx, p.executionId, {
        emitCancelledState: false,
        hard: false,
      })
      processesToEscalate.push({ managed: p, escalationId })
    }
    if (active.length > 0) {
      logger.info({ issueId, interruptedCount: active.length }, 'issue_cancel_soft_interrupted')
      return 'interrupted' as const
    }
    // No active processes — only update session status if it's not already
    // in a terminal state. When an issue moves from review → done, the
    // session has already settled (completed/failed) and we should not
    // overwrite that status or emit a spurious settled event (which would
    // trigger a misleading session.failed webhook).
    const issue = await getIssueWithSession(issueId)
    const currentStatus = issue?.sessionFields.sessionStatus
    const isTerminal = currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled'
    if (!isTerminal) {
      await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
      emitIssueSettled(issueId, '', 'cancelled')
    }
    logger.info({ issueId, cancelledCount: 0, skippedSettle: isTerminal }, 'issue_cancel_completed')
    return 'cancelled' as const
  })

  // Schedule escalation OUTSIDE the lock so it doesn't block other operations.
  // The escalation will retry interrupts and eventually hard-kill if needed.
  if (processesToEscalate.length > 0) {
    void escalateCancel(ctx, issueId, processesToEscalate).catch((err) => {
      logger.error({ issueId, err }, 'cancel_escalation_failed')
    })
  }

  return result
}
