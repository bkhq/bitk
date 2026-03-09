import { stat } from 'node:fs/promises'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { getNextTurnIndex, removeLogEntry } from '@/engines/issue/persistence/queries'
import {
  ensureNoActiveProcess,
  killExistingSubprocessForIssue,
} from '@/engines/issue/process/guards'
import { register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import {
  getPermissionOptions,
  getProjectExecContext,
  isMissingExternalSessionError,
  resolveWorkingDir,
} from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { setIssueDevMode } from '@/engines/issue/utils/visibility'
import {
  createWorktree,
  isWorktreeRegistered,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
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
    permissionMode: PermissionPolicy
    projectId: string
    envVars?: Record<string, string>
    systemPrompt?: string
  },
): Promise<SpawnedProcess> {
  const spawnCtx = {
    vars: opts.envVars ?? {},
    workingDir: opts.workingDir,
    projectId: opts.projectId,
    issueId,
  }
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
      {
        issueId,
        oldExternalSessionId: opts.sessionId,
        newExternalSessionId: externalSessionId,
      },
      'missing_external_session_recreate',
    )
    emitDiagnosticLog(
      issueId,
      '',
      '[BKD] External session not found — recreating with fresh session',
      { event: 'session_recreate' },
    )
    // When recreating a session, prepend the project system prompt
    const freshPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt
    const spawned = await executor.spawn(
      {
        workingDir: opts.workingDir,
        prompt: freshPrompt,
        model: opts.model,
        permissionMode: opts.permissionMode,
        externalSessionId,
      },
      spawnCtx,
    )
    const finalSessionId = spawned.externalSessionId ?? externalSessionId
    await updateIssueSession(issueId, {
      externalSessionId: finalSessionId,
    })
    if (!spawned.externalSessionId) {
      spawned.externalSessionId = finalSessionId
    }
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
    permissionMode: PermissionPolicy
    projectId: string
    envVars?: Record<string, string>
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
    {
      vars: opts.envVars ?? {},
      workingDir: opts.workingDir,
      projectId: opts.projectId,
      issueId,
    },
  )
  const finalSessionId = spawned.externalSessionId ?? externalSessionId
  await updateIssueSession(issueId, {
    externalSessionId: finalSessionId,
  })
  // Ensure the returned object always carries the session ID so callers
  // (e.g. managed.externalSessionId) don't end up with undefined.
  if (!spawned.externalSessionId) {
    spawned.externalSessionId = finalSessionId
  }
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

  const baseDir = await resolveWorkingDir(issue.projectId)

  // Resolve worktree if the issue uses one
  let workingDir = baseDir
  let worktreePath: string | undefined
  if (issue.useWorktree) {
    const candidatePath = resolveWorktreePath(issue.projectId, issueId)
    try {
      const s = await stat(candidatePath)
      if (s.isDirectory()) {
        // Verify the worktree belongs to the current project repo
        if (await isWorktreeRegistered(baseDir, candidatePath)) {
          worktreePath = candidatePath
          workingDir = candidatePath
        } else {
          logger.warn(
            { issueId, candidatePath, baseDir },
            'worktree_not_registered_follow_up_fallback',
          )
        }
      }
    } catch {
      // Worktree doesn't exist — follow-up in base dir
    }
  }

  const permOptions = getPermissionOptions(engineType)
  const executionId = crypto.randomUUID()
  const projCtx = await getProjectExecContext(issue.projectId)

  const spawnOpts = {
    workingDir,
    prompt: issue.sessionFields.prompt ?? '',
    model: issue.sessionFields.model ?? undefined,
    permissionMode: permOptions.permissionMode,
    projectId: issue.projectId,
    envVars: projCtx.envVars,
    systemPrompt: projCtx.systemPrompt,
  }
  const spawned = issue.sessionFields.externalSessionId ?
      await spawnWithSessionFallback(executor, issueId, {
        ...spawnOpts,
        sessionId: issue.sessionFields.externalSessionId,
      }) :
      await spawnFresh(executor, issueId, spawnOpts)

  const normalizer = createLogNormalizer(executor)

  const turnIndex = getNextTurnIndex(issueId)
  const retryManaged = register(
    ctx,
    executionId,
    issueId,
    engineType,
    spawned,
    line => normalizer.parse(line),
    turnIndex,
    worktreePath,
    false,
    () => handleTurnCompleted(ctx, issueId, executionId),
    worktreePath ? baseDir : undefined,
  )
  retryManaged.spawnCwd = workingDir
  retryManaged.externalSessionId =
    spawned.externalSessionId ?? issue.sessionFields.externalSessionId ?? undefined
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
  opts?: { skipPersistMessage?: boolean },
): Promise<{ executionId: string, messageId?: string | null }> {
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
  emitStateChange(issueId, executionId, 'running')
  // When flushing pending messages, the user message is already persisted in the
  // DB. Skip creating a duplicate entry.
  const messageId = opts?.skipPersistMessage ?
    null :
      persistUserMessage(ctx, issueId, executionId, prompt, displayPrompt, metadata)

  const baseDir = await resolveWorkingDir(issue.projectId)

  // Reuse existing worktree if issue has worktree enabled
  let workingDir = baseDir
  let worktreePath: string | undefined
  if (issue.useWorktree) {
    const candidatePath = resolveWorktreePath(issue.projectId, issueId)
    try {
      const s = await stat(candidatePath)
      if (s.isDirectory()) {
        // Verify the worktree is registered under the current project repo;
        // if the project directory was changed, the old worktree is stale.
        if (await isWorktreeRegistered(baseDir, candidatePath)) {
          worktreePath = candidatePath
          workingDir = candidatePath
        } else {
          logger.warn({ issueId, candidatePath, baseDir }, 'worktree_not_registered_recreating')
          worktreePath = await createWorktree(baseDir, issue.projectId, issueId)
          workingDir = worktreePath
        }
      }
    } catch {
      // Worktree dir doesn't exist — create fresh
      try {
        worktreePath = await createWorktree(baseDir, issue.projectId, issueId)
        workingDir = worktreePath
      } catch (wtErr) {
        logger.warn({ issueId, error: wtErr }, 'worktree_creation_failed_fallback_to_base')
      }
    }
  }

  const permOptions = getPermissionOptions(engineType, permissionMode)
  const projCtx = await getProjectExecContext(issue.projectId)

  let spawned: SpawnedProcess
  try {
    spawned = await spawnWithSessionFallback(executor, issueId, {
      workingDir,
      prompt,
      sessionId: issue.sessionFields.externalSessionId,
      model: effectiveModel,
      permissionMode: permOptions.permissionMode,
      projectId: issue.projectId,
      envVars: projCtx.envVars,
      systemPrompt: projCtx.systemPrompt,
    })
  } catch (spawnError) {
    // Spawn failed after we already emitted 'running' and persisted the user
    // message.  Revert the session status so the issue doesn't get stuck in
    // 'running' forever with no process to settle it.
    logger.error({ issueId, executionId, error: spawnError }, 'spawn_failed_reverting_session')
    emitDiagnosticLog(
      issueId,
      executionId,
      `[BKD] Follow-up spawn failed: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
      { event: 'followup_spawn_failed' },
    )
    // Remove the user message persisted before spawn so it doesn't remain as
    // a ghost entry visible to the frontend.
    if (messageId) {
      try {
        removeLogEntry(messageId)
      } catch (e) {
        logger.error({ issueId, messageId, error: e }, 'spawn_failed_remove_user_message_error')
      }
    }
    await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch(e =>
      logger.error({ issueId, error: e }, 'spawn_failed_revert_session_error'),
    )
    emitStateChange(issueId, executionId, 'failed')
    ctx.entryCounters.delete(executionId)
    ctx.turnIndexes.delete(executionId)
    throw spawnError
  }

  const normalizer = createLogNormalizer(executor)

  const followUpManaged = register(
    ctx,
    executionId,
    issueId,
    engineType,
    spawned,
    line => normalizer.parse(line),
    turnIndex,
    worktreePath,
    metadata?.type === 'system',
    () => handleTurnCompleted(ctx, issueId, executionId),
    worktreePath ? baseDir : undefined,
  )
  followUpManaged.spawnCwd = workingDir
  followUpManaged.externalSessionId =
    spawned.externalSessionId ?? issue.sessionFields.externalSessionId ?? undefined
  // User message already persisted above (before spawn)
  monitorCompletion(ctx, executionId, issueId, engineType, false)
  const followUpPid = getPidFromSubprocess(spawned.subprocess)
  logger.info(
    {
      issueId,
      executionId,
      pid: followUpPid,
      engineType,
      turnIndex,
      model: effectiveModel,
    },
    'issue_followup_spawned',
  )
  emitDiagnosticLog(
    issueId,
    executionId,
    `[BKD] Follow-up spawned (engine=${engineType}, pid=${followUpPid}, turn=${turnIndex}, model=${effectiveModel ?? 'default'})`,
    { event: 'followup_spawned', pid: followUpPid, engineType, turnIndex },
  )

  return { executionId, messageId }
}
