import type { EngineType, PermissionPolicy } from '../../types'
import type { EngineContext } from '../context'
import { logger } from '../../../logger'
import { getIssueWithSession, updateIssueSession } from '../../engine-store'
import { engineRegistry } from '../../executors'
import { monitorCompletion } from '../lifecycle/completion-monitor'
import { handleTurnCompleted } from '../lifecycle/turn-completion'
import { ensureNoActiveProcess } from '../process/guards'
import { withIssueLock } from '../process/lock'
import { register } from '../process/register'
import { persistUserMessage } from '../user-message'
import { getPermissionOptions } from '../utils/helpers'
import { createLogNormalizer } from '../utils/normalizer'
import { getPidFromSubprocess } from '../utils/pid'
import { setIssueDevMode } from '../utils/visibility'
import { captureBaseCommitHash, createWorktree } from '../utils/worktree'

export async function executeIssue(
  ctx: EngineContext,
  issueId: string,
  opts: {
    engineType: EngineType
    prompt: string
    workingDir?: string
    model?: string
    permissionMode?: PermissionPolicy
  },
): Promise<{ executionId: string; messageId?: string | null }> {
  return withIssueLock(ctx, issueId, async () => {
    logger.debug(
      {
        issueId,
        engineType: opts.engineType,
        model: opts.model,
        hasWorkingDir: !!opts.workingDir,
      },
      'issue_execute_requested',
    )
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)
    setIssueDevMode(issueId, issue.devMode)

    ensureNoActiveProcess(ctx, issueId)

    const executor = engineRegistry.get(opts.engineType)
    if (!executor) throw new Error(`No executor for engine type: ${opts.engineType}`)

    let model = opts.model
    if (!model) {
      const { getEngineDefaultModel } = await import('../../../db/helpers')
      const defaultModel = await getEngineDefaultModel(opts.engineType)
      if (defaultModel) model = defaultModel
    }

    await updateIssueSession(issueId, {
      engineType: opts.engineType,
      sessionStatus: 'running',
      prompt: opts.prompt,
      model,
    })

    const baseDir = opts.workingDir ?? process.cwd()
    let workingDir = baseDir
    let worktreePath: string | undefined

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

    const permOptions = getPermissionOptions(opts.engineType, opts.permissionMode)
    const externalSessionId = crypto.randomUUID()
    const executionId = crypto.randomUUID()

    const spawned = await executor.spawn(
      {
        workingDir,
        prompt: opts.prompt,
        model,
        permissionMode: permOptions.permissionMode as any,
        externalSessionId,
      },
      {
        vars: {},
        workingDir,
        projectId: issue.projectId,
        issueId,
      },
    )

    // Allow executor to override the external session ID (e.g. Codex uses server-generated thread IDs)
    const finalExternalSessionId = spawned.externalSessionId ?? externalSessionId
    await updateIssueSession(issueId, { externalSessionId: finalExternalSessionId })
    logger.info(
      {
        issueId,
        executionId,
        pid: getPidFromSubprocess(spawned.subprocess),
        engineType: opts.engineType,
        externalSessionId: finalExternalSessionId,
        worktreePath,
      },
      'issue_execute_spawned',
    )

    const normalizer = await createLogNormalizer(executor)

    register(
      ctx,
      executionId,
      issueId,
      spawned,
      (line) => normalizer.parse(line),
      0,
      worktreePath,
      false,
      () => handleTurnCompleted(ctx, issueId, executionId),
    )
    const messageId = persistUserMessage(ctx, issueId, executionId, opts.prompt)
    monitorCompletion(ctx, executionId, issueId, opts.engineType, false)

    return { executionId, messageId }
  })
}
