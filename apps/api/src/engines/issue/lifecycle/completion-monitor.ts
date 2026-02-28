import type { EngineContext } from '@/engines/issue/context'
import type { ManagedProcess } from '@/engines/issue/types'
import type { EngineType, ProcessStatus } from '@/engines/types'
import { updateIssueSession } from '@/engines/engine-store'
import { MAX_AUTO_RETRIES } from '@/engines/issue/constants'
import { emitStateChange } from '@/engines/issue/events'
import { cleanupDomainData, syncPmState } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'
import { settleIssue } from './settle'
import { spawnFollowUpProcess, spawnRetry } from './spawn'

// ---------- Helpers ----------

/**
 * Detect session ID error: the CLI spawned but couldn't find the session
 * (e.g. "No conversation found with session ID: xxx" after project directory
 * change).  Only returns true when the error specifically mentions the session,
 * so other failures (API errors, network issues, etc.) don't clear a valid session.
 */
function isSessionIdError(managed: ManagedProcess): boolean {
  if (managed.logs.toArray().some((l) => l.entryType === 'assistant-message')) return false
  const reason = (managed.logicalFailureReason ?? '').toLowerCase()
  return reason.includes('no conversation found') || reason.includes('session')
}

/**
 * Clear the externalSessionId in DB so the next spawn creates a fresh session.
 */
async function resetBrokenSession(issueId: string, executionId: string): Promise<void> {
  logger.warn({ issueId, executionId }, 'session_init_failure_resetting_session')
  await updateIssueSession(issueId, { externalSessionId: null }).catch((e) =>
    logger.error({ issueId, error: e }, 'session_reset_failed'),
  )
}

// ---------- Completion monitoring ----------

export function monitorCompletion(
  ctx: EngineContext,
  executionId: string,
  issueId: string,
  engineType: EngineType,
  isRetry: boolean,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed) return

  void (async () => {
    try {
      const exitCode = await managed.process.subprocess.exited
      dispatch(managed, { type: 'SET_EXIT_CODE', exitCode })
      logger.info(
        {
          issueId,
          executionId,
          pid: getPidFromManaged(managed),
          exitCode,
          queued: managed.pendingInputs.length,
          state: managed.state,
        },
        'issue_process_exited',
      )

      // If the issue was already settled by handleTurnCompleted (conversational
      // engines where the process stays alive between turns), just clean up.
      if (managed.turnSettled) {
        const finalState = (managed.logicalFailure ? 'failed' : 'completed') as ProcessStatus
        if (finalState === 'completed') dispatch(managed, { type: 'MARK_COMPLETED' })
        else dispatch(managed, { type: 'MARK_FAILED' })
        syncPmState(ctx, executionId, finalState)

        // When the turn was already settled as failed due to a session ID error,
        // reset the session and auto-retry with a fresh session.
        if (finalState === 'failed' && isSessionIdError(managed)) {
          await resetBrokenSession(issueId, executionId)
          if (!isRetry && managed.retryCount < MAX_AUTO_RETRIES) {
            managed.retryCount++
            logger.info(
              { issueId, executionId, retryCount: managed.retryCount },
              'auto_retry_after_session_reset',
            )
            cleanupDomainData(ctx, executionId)
            try {
              await spawnRetry(ctx, issueId, engineType)
            } catch (retryErr) {
              logger.error({ issueId, err: retryErr }, 'auto_retry_failed')
            }
            return
          }
        }

        cleanupDomainData(ctx, executionId)
        return
      }

      // If user queued follow-ups while process was active, continue them in order
      // using a fresh follow-up process after this one exits.
      if (managed.pendingInputs.length > 0) {
        const queued = [...managed.pendingInputs]
        dispatch(managed, { type: 'CLEAR_PENDING_INPUTS' })
        cleanupDomainData(ctx, executionId)
        try {
          const first = queued.shift()
          if (!first) return
          const result = await spawnFollowUpProcess(
            ctx,
            issueId,
            first.prompt,
            first.model,
            first.permissionMode,
            undefined,
            first.metadata,
          )
          const nextManaged = ctx.pm.get(result.executionId)?.meta
          if (nextManaged && queued.length > 0) {
            nextManaged.pendingInputs.push(...queued)
            logger.debug(
              {
                issueId,
                fromExecutionId: executionId,
                toExecutionId: result.executionId,
                queued: queued.length,
              },
              'issue_process_carryover_queue_to_new_process',
            )
          }
          return
        } catch (error) {
          logger.error({ issueId, executionId, error }, 'queued_followup_spawn_failed')
        }
      }

      if (managed.cancelledByUser || managed.state === 'cancelled') {
        syncPmState(ctx, executionId, 'cancelled')
        await settleIssue(ctx, issueId, executionId, 'cancelled')
        return
      }

      const logicalFailure = managed.logicalFailure
      if (exitCode === 0 && !logicalFailure) {
        dispatch(managed, { type: 'MARK_COMPLETED' })
        syncPmState(ctx, executionId, 'completed')
        emitStateChange(ctx, issueId, executionId, 'completed')
        await settleIssue(ctx, issueId, executionId, 'completed')
      } else {
        dispatch(managed, { type: 'MARK_FAILED' })
        syncPmState(ctx, executionId, 'failed')
        emitStateChange(ctx, issueId, executionId, 'failed')
        logger.warn(
          {
            issueId,
            executionId,
            exitCode,
            logicalFailure,
            logicalFailureReason: managed.logicalFailureReason,
          },
          'issue_process_marked_failed',
        )

        // Reset broken session before retry so spawnRetry creates a fresh one
        if (isSessionIdError(managed)) {
          await resetBrokenSession(issueId, executionId)
        }

        // Auto-retry logic (in-memory only, no DB writes for retryCount)
        if (!isRetry && managed.retryCount < MAX_AUTO_RETRIES) {
          managed.retryCount++
          logger.info({ issueId, executionId, retryCount: managed.retryCount }, 'auto_retry_issue')
          cleanupDomainData(ctx, executionId)

          try {
            await spawnRetry(ctx, issueId, engineType)
          } catch (retryErr) {
            logger.error({ issueId, err: retryErr }, 'auto_retry_failed')
            await settleIssue(ctx, issueId, executionId, 'failed')
          }
        } else {
          await settleIssue(ctx, issueId, executionId, 'failed')
        }
      }
    } catch {
      dispatch(managed, { type: 'MARK_FAILED' })
      syncPmState(ctx, executionId, 'failed')
      emitStateChange(ctx, issueId, executionId, 'failed')
      await settleIssue(ctx, issueId, executionId, 'failed')
    }
  })()
}
