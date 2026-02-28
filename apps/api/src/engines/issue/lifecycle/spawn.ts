import type { EngineContext } from '@/engines/issue/context'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { emitStateChange } from '@/engines/issue/events'
import { getNextTurnIndex } from '@/engines/issue/persistence/queries'
import { ensureNoActiveProcess, killExistingSubprocessForIssue } from '@/engines/issue/process/guards'
import { register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import {
  getPermissionOptions,
  isMissingExternalSessionError,
  resolveWorkingDir,
} from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { setIssueDevMode } from '@/engines/issue/utils/visibility'
import { createWorktree } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'
import { monitorCompletion } from './completion-monitor'
import { handleTurnCompleted } from './turn-completion'

// ---------- Spawn helpers ----------

/**
 * Try spawnFollowUp; if the external session is missing, fall back to a fresh spawn.
 */
export async function spawnWithSessionFallback(
  executor: ReturnType<typeof engineRegistry.get> & object,
  issueId: string,
  opts: {
    workingDir: string
    prompt: string
    sessionId: string
    model?: string
    permissionMode: string
    projectId: string
  },
): Promise<SpawnedProcess> {
  const spawnCtx = { vars: {}, workingDir: opts.workingDir, projectId: opts.projectId, issueId }
  try {
    return await executor.spawnFollowUp(
      {
        workingDir: opts.workingDir,
        prompt: opts.prompt,
        sessionId: opts.sessionId,
        model: opts.model,
        permissionMode: opts.permissionMode,
      },
      spawnCtx,
    )
  } catch (error) {
    if (!isMissingExternalSessionError(error)) throw error
    const externalSessionId = crypto.randomUUID()
    logger.warn(
      { issueId, oldExternalSessionId: opts.sessionId, newExternalSessionId: externalSessionId },
      'missing_external_session_recreate',
    )
    const spawned = await executor.spawn(
      {
        workingDir: opts.workingDir,
        prompt: opts.prompt,
        model: opts.model,
        permissionMode: opts.permissionMode,
        externalSessionId,
      },
      spawnCtx,
    )
    await updateIssueSession(issueId, {
      externalSessionId: spawned.externalSessionId ?? externalSessionId,
    })
    return spawned
  }
}

/** Spawn a fresh process (no existing session). */
export async function spawnFresh(
  executor: ReturnType<typeof engineRegistry.get> & object,
  issueId: string,
  opts: {
    workingDir: string
    prompt: string
    model?: string
    permissionMode: string
    projectId: string
  },
): Promise<SpawnedProcess> {
  const externalSessionId = crypto.randomUUID()
  const spawned = await executor.spawn(
    {
      workingDir: opts.workingDir,
      prompt: opts.prompt,
      model: opts.model,
      permissionMode: opts.permissionMode,
      externalSessionId,
    },
    { vars: {}, workingDir: opts.workingDir, projectId: opts.projectId, issueId },
  )
  await updateIssueSession(issueId, {
    externalSessionId: spawned.externalSessionId ?? externalSessionId,
  })
  return spawned
}

export async function spawnRetry(
  ctx: EngineContext,
  issueId: string,
  engineType: EngineType,
): Promise<void> {
  logger.debug({ issueId, engineType }, 'issue_retry_requested')
  const issue = await getIssueWithSession(issueId)
  if (!issue) throw new Error(`Issue not found: ${issueId}`)

  ensureNoActiveProcess(ctx, issueId)

  const executor = engineRegistry.get(engineType)
  if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

  const workingDir = await resolveWorkingDir(issue.projectId)
  const permOptions = getPermissionOptions(engineType)
  const executionId = crypto.randomUUID()

  const spawnOpts = {
    workingDir,
    prompt: issue.sessionFields.prompt ?? '',
    model: issue.sessionFields.model ?? undefined,
    permissionMode: permOptions.permissionMode,
    projectId: issue.projectId,
  }
  const spawned = issue.sessionFields.externalSessionId
    ? await spawnWithSessionFallback(executor, issueId, {
        ...spawnOpts,
        sessionId: issue.sessionFields.externalSessionId,
      })
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
    undefined,
    false,
    () => handleTurnCompleted(ctx, issueId, executionId),
  )
  monitorCompletion(ctx, executionId, issueId, engineType, true)
  logger.debug({ issueId, executionId, engineType, turnIndex }, 'issue_retry_spawned')
}

export async function spawnFollowUpProcess(
  ctx: EngineContext,
  issueId: string,
  prompt: string,
  model?: string,
  permissionMode?: PermissionPolicy,
  displayPrompt?: string,
  metadata?: Record<string, unknown>,
): Promise<{ executionId: string; messageId?: string | null }> {
  logger.debug(
    { issueId, model, permissionMode, promptChars: prompt.length },
    'issue_followup_spawn_process_requested',
  )
  const issue = await getIssueWithSession(issueId)
  if (!issue) throw new Error(`Issue not found: ${issueId}`)
  setIssueDevMode(issueId, issue.devMode)
  if (!issue.sessionFields.externalSessionId)
    throw new Error('No external session ID for follow-up')
  if (!issue.sessionFields.engineType) throw new Error('No engine type set on issue')

  // Safety guard: kill any existing subprocess for this issue to prevent
  // duplicate CLI processes talking to the same Claude session.
  await killExistingSubprocessForIssue(ctx, issueId)

  const engineType = issue.sessionFields.engineType
  const executor = engineRegistry.get(engineType)
  if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

  if (model && model !== issue.sessionFields.model) {
    await updateIssueSession(issueId, { model })
  }

  const executionId = crypto.randomUUID()
  const effectiveModel = model ?? issue.sessionFields.model ?? undefined

  await updateIssueSession(issueId, { sessionStatus: 'running' })

  // Emit SSE 'running' and persist user message BEFORE the potentially slow
  // process spawn (1-10s for CLI download + startup).  This lets the frontend
  // show the thinking indicator immediately instead of waiting for spawn.
  const turnIndex = getNextTurnIndex(issueId)
  ctx.entryCounters.set(executionId, 0)
  ctx.turnIndexes.set(executionId, turnIndex)
  emitStateChange(ctx, issueId, executionId, 'running')
  const messageId = persistUserMessage(ctx, issueId, executionId, prompt, displayPrompt, metadata)

  const baseDir = await resolveWorkingDir(issue.projectId)

  // Reuse existing worktree if issue has worktree enabled
  let workingDir = baseDir
  let worktreePath: string | undefined
  if (issue.useWorktree) {
    const candidatePath = join(baseDir, WORKTREE_DIR, issueId)
    try {
      const s = await stat(candidatePath)
      if (s.isDirectory()) {
        worktreePath = candidatePath
        workingDir = candidatePath
      }
    } catch {
      // Worktree dir doesn't exist — create fresh
      try {
        worktreePath = await createWorktree(baseDir, issueId)
        workingDir = worktreePath
      } catch (wtErr) {
        logger.warn({ issueId, error: wtErr }, 'worktree_creation_failed_fallback_to_base')
      }
    }
  }

  const permOptions = getPermissionOptions(engineType, permissionMode)

  let spawned: SpawnedProcess
  try {
    spawned = await spawnWithSessionFallback(executor, issueId, {
      workingDir,
      prompt,
      sessionId: issue.sessionFields.externalSessionId,
      model: effectiveModel,
      permissionMode: permOptions.permissionMode,
      projectId: issue.projectId,
    })
  } catch (spawnError) {
    // Spawn failed after we already emitted 'running' and persisted the user
    // message.  Revert the session status so the issue doesn't get stuck in
    // 'running' forever with no process to settle it.
    logger.error({ issueId, executionId, error: spawnError }, 'spawn_failed_reverting_session')
    await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch((e) =>
      logger.error({ issueId, error: e }, 'spawn_failed_revert_session_error'),
    )
    emitStateChange(ctx, issueId, executionId, 'failed')
    ctx.entryCounters.delete(executionId)
    ctx.turnIndexes.delete(executionId)
    throw spawnError
  }

  const normalizer = await createLogNormalizer(executor)

  register(
    ctx,
    executionId,
    issueId,
    spawned,
    (line) => normalizer.parse(line),
    turnIndex,
    worktreePath,
    metadata?.type === 'system',
    () => handleTurnCompleted(ctx, issueId, executionId),
  )
  // User message already persisted above (before spawn)
  monitorCompletion(ctx, executionId, issueId, engineType, false)
  logger.info(
    {
      issueId,
      executionId,
      pid: getPidFromSubprocess(spawned.subprocess),
      engineType,
      turnIndex,
      model: effectiveModel,
    },
    'issue_followup_spawned',
  )

  return { executionId, messageId }
}
