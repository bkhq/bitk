import { cleanupStaleSessions } from '@/db/helpers'
import {
  collectPendingWithAttachments,
  markPendingMessagesDispatched,
} from '@/db/pending-messages'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitStateChange } from '@/engines/issue/events'
import { monitorCompletion } from '@/engines/issue/lifecycle/completion-monitor'
import { spawnFresh } from '@/engines/issue/lifecycle/spawn'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { getNextTurnIndex } from '@/engines/issue/persistence/queries'
import { ensureNoActiveProcess } from '@/engines/issue/process/guards'
import { withIssueLock } from '@/engines/issue/process/lock'
import { register } from '@/engines/issue/process/register'
import {
  getPermissionOptions,
  getProjectExecContext,
  resolveWorkingDir,
} from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { createWorktree } from '@/engines/issue/utils/worktree'
import type { SpawnedProcess } from '@/engines/types'
import { logger } from '@/logger'

export async function restartIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<{ executionId: string }> {
  return withIssueLock(ctx, issueId, async () => {
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)

    const status = issue.sessionFields.sessionStatus
    if (status !== 'failed' && status !== 'cancelled')
      throw new Error(`Cannot restart issue in session status: ${status}`)

    if (!issue.sessionFields.engineType)
      throw new Error('No engine type set on issue')
    if (!issue.sessionFields.prompt) throw new Error('No prompt set on issue')

    ensureNoActiveProcess(ctx, issueId)

    const engineType = issue.sessionFields.engineType
    const executor = engineRegistry.get(engineType)
    if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

    // Collect pending messages to merge into the restart prompt
    const { prompt: pendingPrompt, pendingIds } =
      await collectPendingWithAttachments(issueId)

    await updateIssueSession(issueId, { sessionStatus: 'running' })

    const baseDir = await resolveWorkingDir(issue.projectId)
    let workingDir = baseDir
    let worktreePath: string | undefined

    // Create git worktree if enabled for this issue
    if (issue.useWorktree) {
      try {
        worktreePath = await createWorktree(baseDir, issue.projectId, issueId)
        workingDir = worktreePath
      } catch (error) {
        logger.warn(
          { issueId, error },
          'worktree_creation_failed_fallback_to_base',
        )
      }
    }

    const permOptions = getPermissionOptions(engineType)
    const executionId = crypto.randomUUID()
    const projCtx = await getProjectExecContext(issue.projectId)

    // Prepend project system prompt + merge pending messages
    const basePrompt = projCtx.systemPrompt
      ? `${projCtx.systemPrompt}\n\n${issue.sessionFields.prompt ?? ''}`
      : (issue.sessionFields.prompt ?? '')
    const effectivePrompt = pendingPrompt
      ? [basePrompt, pendingPrompt].filter(Boolean).join('\n\n')
      : basePrompt

    const spawnOpts = {
      workingDir,
      prompt: effectivePrompt,
      model: issue.sessionFields.model ?? undefined,
      permissionMode: permOptions.permissionMode,
      projectId: issue.projectId,
      envVars: projCtx.envVars,
    }
    let spawned: SpawnedProcess
    try {
      spawned = issue.sessionFields.externalSessionId
        ? await executor.spawnFollowUp(
            {
              workingDir,
              prompt: spawnOpts.prompt,
              sessionId: issue.sessionFields.externalSessionId,
              model: spawnOpts.model,
              permissionMode: spawnOpts.permissionMode,
            },
            {
              vars: projCtx.envVars ?? {},
              workingDir,
              projectId: issue.projectId,
              issueId,
            },
          )
        : await spawnFresh(executor, issueId, spawnOpts)
    } catch (spawnError) {
      logger.error(
        { issueId, executionId, error: spawnError },
        'restart_spawn_failed_reverting_session',
      )
      await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch(
        (e) =>
          logger.error(
            { issueId, error: e },
            'restart_spawn_failed_revert_session_error',
          ),
      )
      emitStateChange(issueId, executionId, 'failed')
      throw spawnError
    }

    const normalizer = await createLogNormalizer(executor)

    const turnIndex = getNextTurnIndex(issueId)
    register(
      ctx,
      executionId,
      issueId,
      engineType,
      spawned,
      (line) => normalizer.parse(line),
      turnIndex,
      worktreePath,
      false,
      () => handleTurnCompleted(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
    )
    monitorCompletion(ctx, executionId, issueId, engineType, false)

    // Mark pending messages as dispatched after successful spawn
    if (pendingIds.length > 0) {
      await markPendingMessagesDispatched(pendingIds)
      logger.info(
        { issueId, pendingCount: pendingIds.length },
        'restart_pending_messages_dispatched',
      )
    }

    return { executionId }
  })
}

export async function restartStaleSessions(): Promise<number> {
  return cleanupStaleSessions()
}
