import type { EngineType, PermissionPolicy, SpawnedProcess } from '../../types'
import type { EngineContext } from '../context'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '../../../logger'
import { getIssueWithSession, updateIssueSession } from '../../engine-store'
import { engineRegistry } from '../../executors'
import { WORKTREE_DIR } from '../constants'
import { getNextTurnIndex } from '../persistence/queries'
import { ensureNoActiveProcess, killExistingSubprocessForIssue } from '../process/guards'
import { register } from '../process/register'
import { persistUserMessage } from '../user-message'
import {
  getPermissionOptions,
  isMissingExternalSessionError,
  resolveWorkingDir,
} from '../utils/helpers'
import { createLogNormalizer } from '../utils/normalizer'
import { getPidFromSubprocess } from '../utils/pid'
import { setIssueDevMode } from '../utils/visibility'
import { createWorktree } from '../utils/worktree'
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

  await updateIssueSession(issueId, { sessionStatus: 'running' })

  const effectiveModel = model ?? issue.sessionFields.model ?? undefined
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
  const executionId = crypto.randomUUID()

  const spawned = await spawnWithSessionFallback(executor, issueId, {
    workingDir,
    prompt,
    sessionId: issue.sessionFields.externalSessionId,
    model: effectiveModel,
    permissionMode: permOptions.permissionMode,
    projectId: issue.projectId,
  })

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
    metadata?.type === 'system',
    () => handleTurnCompleted(ctx, issueId, executionId),
  )
  const messageId = persistUserMessage(ctx, issueId, executionId, prompt, displayPrompt, metadata)
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
