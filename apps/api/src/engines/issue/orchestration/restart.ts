import type { EngineContext } from '@/engines/issue/context'
import { cleanupStaleSessions } from '@/db/helpers'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { monitorCompletion } from '@/engines/issue/lifecycle/completion-monitor'
import { spawnFresh } from '@/engines/issue/lifecycle/spawn'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { getNextTurnIndex } from '@/engines/issue/persistence/queries'
import { ensureNoActiveProcess } from '@/engines/issue/process/guards'
import { withIssueLock } from '@/engines/issue/process/lock'
import { register } from '@/engines/issue/process/register'
import { getPermissionOptions, resolveWorkingDir } from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { captureBaseCommitHash, createWorktree } from '@/engines/issue/utils/worktree'
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

    if (!issue.sessionFields.engineType) throw new Error('No engine type set on issue')
    if (!issue.sessionFields.prompt) throw new Error('No prompt set on issue')

    ensureNoActiveProcess(ctx, issueId)

    const engineType = issue.sessionFields.engineType
    const executor = engineRegistry.get(engineType)
    if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

    await updateIssueSession(issueId, { sessionStatus: 'running' })

    const baseDir = await resolveWorkingDir(issue.projectId)
    let workingDir = baseDir
    let worktreePath: string | undefined

    // Create git worktree if enabled for this issue
    if (issue.useWorktree) {
      try {
        worktreePath = await createWorktree(baseDir, issueId)
        workingDir = worktreePath
      } catch (error) {
        logger.warn({ issueId, error }, 'worktree_creation_failed_fallback_to_base')
      }
    }

    const baseCommitHash = await captureBaseCommitHash(workingDir)
    if (baseCommitHash) await updateIssueSession(issueId, { baseCommitHash })

    const permOptions = getPermissionOptions(engineType)
    const executionId = crypto.randomUUID()

    const spawnOpts = {
      workingDir,
      prompt: issue.sessionFields.prompt,
      model: issue.sessionFields.model ?? undefined,
      permissionMode: permOptions.permissionMode,
      projectId: issue.projectId,
    }
    const spawned = issue.sessionFields.externalSessionId
      ? await executor.spawnFollowUp(
          {
            workingDir,
            prompt: spawnOpts.prompt,
            sessionId: issue.sessionFields.externalSessionId,
            model: spawnOpts.model,
            permissionMode: spawnOpts.permissionMode,
          },
          { vars: {}, workingDir, projectId: issue.projectId, issueId },
        )
      : await spawnFresh(executor, issueId, spawnOpts)

    const normalizer = await createLogNormalizer(executor)

    const turnIndex = getNextTurnIndex(issueId)
    register(
      ctx,
      executionId,
      issueId,
      spawned,
      (line) => normalizer.parse(line),
      turnIndex,
      worktreePath,
      false,
      () => handleTurnCompleted(ctx, issueId, executionId),
    )
    monitorCompletion(ctx, executionId, issueId, engineType, false)

    return { executionId }
  })
}

export async function restartStaleSessions(): Promise<number> {
  return cleanupStaleSessions()
}
