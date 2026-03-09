import { getEngineDefaultModel } from '@/db/helpers'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { monitorCompletion } from '@/engines/issue/lifecycle/completion-monitor'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { ensureNoActiveProcess } from '@/engines/issue/process/guards'
import { withIssueLock } from '@/engines/issue/process/lock'
import { register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import { getPermissionOptions } from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { setIssueDevMode } from '@/engines/issue/utils/visibility'
import { createWorktree } from '@/engines/issue/utils/worktree'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

export async function executeIssue(
  ctx: EngineContext,
  issueId: string,
  opts: {
    engineType: EngineType
    prompt: string
    workingDir?: string
    model?: string
    permissionMode?: PermissionPolicy
    envVars?: Record<string, string>
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

    // Guard: reject engines that are registered but not yet executable (e.g. Gemini stub)
    const avail = await executor.getAvailability()
    if (avail.executable === false) {
      throw new Error(`Engine '${opts.engineType}' is not yet executable (spawn not implemented)`)
    }

    let model = opts.model
    if (!model) {
      const defaultModel = await getEngineDefaultModel(opts.engineType)
      if (defaultModel) model = defaultModel
    }

    await updateIssueSession(issueId, {
      engineType: opts.engineType,
      sessionStatus: 'running',
      prompt: opts.prompt,
      model,
    })

    const baseDir = opts.workingDir ?? ROOT_DIR
    let workingDir = baseDir
    let worktreePath: string | undefined

    if (issue.useWorktree) {
      try {
        worktreePath = await createWorktree(baseDir, issue.projectId, issueId)
        workingDir = worktreePath
      } catch (error) {
        logger.warn({ issueId, error }, 'worktree_creation_failed_fallback_to_base')
      }
    }

    const permOptions = getPermissionOptions(opts.engineType, opts.permissionMode)
    const externalSessionId = crypto.randomUUID()
    const executionId = crypto.randomUUID()

    let spawned: SpawnedProcess
    try {
      spawned = await executor.spawn(
        {
          workingDir,
          prompt: opts.prompt,
          model,
          permissionMode: permOptions.permissionMode,
          externalSessionId,
        },
        {
          vars: opts.envVars ?? {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
    } catch (spawnError) {
      logger.error(
        { issueId, executionId, error: spawnError },
        'execute_spawn_failed_reverting_session',
      )
      emitDiagnosticLog(
        issueId,
        executionId,
        `[BKD] Process spawn failed: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
        { event: 'spawn_failed' },
      )
      await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch((e) =>
        logger.error({ issueId, error: e }, 'execute_spawn_failed_revert_session_error'),
      )
      emitStateChange(issueId, executionId, 'failed')
      throw spawnError
    }

    // Allow executor to override the external session ID (e.g. Codex uses server-generated thread IDs)
    const finalExternalSessionId = spawned.externalSessionId ?? externalSessionId
    await updateIssueSession(issueId, {
      externalSessionId: finalExternalSessionId,
    })
    const pid = getPidFromSubprocess(spawned.subprocess)
    logger.info(
      {
        issueId,
        executionId,
        pid,
        engineType: opts.engineType,
        externalSessionId: finalExternalSessionId,
        worktreePath,
      },
      'issue_execute_spawned',
    )
    const normalizer = createLogNormalizer(executor)

    const execManaged = register(
      ctx,
      executionId,
      issueId,
      opts.engineType,
      spawned,
      (line) => normalizer.parse(line),
      0,
      worktreePath,
      false,
      () => handleTurnCompleted(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
    )
    execManaged.spawnCwd = workingDir
    execManaged.externalSessionId = finalExternalSessionId
    emitDiagnosticLog(
      issueId,
      executionId,
      `[BKD] Process spawned (engine=${opts.engineType}, pid=${pid}, model=${model ?? 'default'})`,
      { event: 'process_spawned', pid, engineType: opts.engineType, model },
    )
    const messageId = persistUserMessage(ctx, issueId, executionId, opts.prompt)
    monitorCompletion(ctx, executionId, issueId, opts.engineType, false)

    return { executionId, messageId }
  })
}
