import type { EngineType, ProcessStatus } from '../../types'
import type { EngineContext } from '../context'
import { logger } from '../../../logger'
import { MAX_AUTO_RETRIES } from '../constants'
import { emitStateChange } from '../events'
import { cleanupDomainData, syncPmState } from '../process/state'
import { getPidFromManaged } from '../utils/pid'
import { settleIssue } from './settle'
import { spawnFollowUpProcess, spawnRetry } from './spawn'

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
      managed.exitCode = exitCode
      managed.finishedAt = new Date()
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
        managed.state = finalState
        managed.finishedAt = new Date()
        syncPmState(ctx, executionId, finalState)
        cleanupDomainData(ctx, executionId)
        return
      }

      // If user queued follow-ups while process was active, continue them in order
      // using a fresh follow-up process after this one exits.
      if (managed.pendingInputs.length > 0) {
        const queued = [...managed.pendingInputs]
        managed.pendingInputs = []
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
        managed.state = 'completed'
        syncPmState(ctx, executionId, 'completed')
        emitStateChange(ctx, issueId, executionId, 'completed')
        await settleIssue(ctx, issueId, executionId, 'completed')
      } else {
        managed.state = 'failed'
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
      managed.state = 'failed'
      managed.finishedAt = new Date()
      syncPmState(ctx, executionId, 'failed')
      emitStateChange(ctx, issueId, executionId, 'failed')
      await settleIssue(ctx, issueId, executionId, 'failed')
    }
  })()
}
