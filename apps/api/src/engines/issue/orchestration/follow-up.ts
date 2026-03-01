import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { spawnFollowUpProcess } from '@/engines/issue/lifecycle/spawn'
import { cancel } from '@/engines/issue/process/cancel'
import { withIssueLock } from '@/engines/issue/process/lock'
import { getActiveProcessForIssue } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import { sendInputToRunningProcess } from '@/engines/issue/user-message'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { setIssueDevMode } from '@/engines/issue/utils/visibility'
import type { PermissionPolicy } from '@/engines/types'
import { logger } from '@/logger'

export async function followUpIssue(
  ctx: EngineContext,
  issueId: string,
  prompt: string,
  model?: string,
  permissionMode?: PermissionPolicy,
  busyAction: 'queue' | 'cancel' = 'queue',
  displayPrompt?: string,
  metadata?: Record<string, unknown>,
): Promise<{ executionId: string; messageId?: string | null }> {
  return withIssueLock(ctx, issueId, async () => {
    logger.debug(
      {
        issueId,
        model,
        permissionMode,
        busyAction,
        promptChars: prompt.length,
      },
      'issue_followup_requested',
    )
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)
    setIssueDevMode(issueId, issue.devMode)

    if (!issue.sessionFields.externalSessionId)
      throw new Error('No external session ID for follow-up')
    if (!issue.sessionFields.engineType)
      throw new Error('No engine type set on issue')

    const engineType = issue.sessionFields.engineType
    const executor = engineRegistry.get(engineType)
    if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

    const effectiveModel = model ?? issue.sessionFields.model ?? undefined
    if (model && model !== issue.sessionFields.model) {
      await updateIssueSession(issueId, { model })
    }

    const active = getActiveProcessForIssue(ctx, issueId)
    if (active) {
      await updateIssueSession(issueId, { sessionStatus: 'running' })
      logger.debug(
        {
          issueId,
          executionId: active.executionId,
          pid: getPidFromManaged(active),
          state: active.state,
          turnInFlight: active.turnInFlight,
          queued: active.pendingInputs.length,
          busyAction,
        },
        'issue_followup_active_process_detected',
      )

      // If process is canceling/spawning or a turn is in progress, queue user input
      // and process it only after the current turn/process boundary is reached.
      if (active.state !== 'running' || active.turnInFlight) {
        dispatch(active, {
          type: 'QUEUE_INPUT',
          input: {
            prompt,
            model: effectiveModel,
            permissionMode,
            busyAction,
            displayPrompt,
            metadata,
          },
        })
        logger.debug(
          {
            issueId,
            executionId: active.executionId,
            pid: getPidFromManaged(active),
            state: active.state,
            turnInFlight: active.turnInFlight,
            busyAction,
            queued: active.pendingInputs.length,
          },
          'issue_followup_queued',
        )

        if (
          busyAction === 'cancel' &&
          active.state === 'running' &&
          !active.queueCancelRequested
        ) {
          dispatch(active, { type: 'REQUEST_QUEUE_CANCEL' })
          logger.debug(
            {
              issueId,
              executionId: active.executionId,
              pid: getPidFromManaged(active),
              queued: active.pendingInputs.length,
            },
            'issue_followup_queue_requested_cancel_current',
          )
          void cancel(ctx, active.executionId, {
            emitCancelledState: false,
          }).catch((error) => {
            logger.warn(
              { issueId, executionId: active.executionId, error },
              'queue_cancel_failed',
            )
          })
        }
        return { executionId: active.executionId, messageId: null }
      }

      // Engine is idle: send immediately on existing process.
      // If this races with process exit, fall back to spawning a follow-up process.
      try {
        const msgId = sendInputToRunningProcess(
          ctx,
          issueId,
          active,
          prompt,
          displayPrompt,
          metadata,
        )
        return { executionId: active.executionId, messageId: msgId }
      } catch (error) {
        logger.warn(
          {
            issueId,
            executionId: active.executionId,
            pid: getPidFromManaged(active),
            error: error instanceof Error ? error.message : String(error),
          },
          'issue_followup_active_send_failed_fallback_spawn',
        )
        return spawnFollowUpProcess(
          ctx,
          issueId,
          prompt,
          effectiveModel,
          permissionMode,
          displayPrompt,
          metadata,
        )
      }
    }

    logger.debug(
      { issueId, engineType, model: effectiveModel },
      'issue_followup_spawn_new_process',
    )
    return spawnFollowUpProcess(
      ctx,
      issueId,
      prompt,
      effectiveModel,
      permissionMode,
      displayPrompt,
      metadata,
    )
  })
}
