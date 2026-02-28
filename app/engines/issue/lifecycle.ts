import type { EngineType, PermissionPolicy, ProcessStatus, SpawnedProcess } from '../types'
import type { EngineContext } from './context'
import type { ManagedProcess } from './types'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getPendingMessages, markPendingMessagesDispatched } from '../../db/pending-messages'
import { logger } from '../../logger'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '../engine-store'
import { engineRegistry } from '../executors'
import { loadFilterRules } from '../write-filter'
import { getPidFromManaged, getPidFromSubprocess } from './context'
import { persistUserMessage, register, sendInputToRunningProcess } from './entry-handlers'
import { emitIssueSettled, emitStateChange } from './events'
import {
  createWorktree,
  getPermissionOptions,
  isMissingExternalSessionError,
  resolveWorkingDir,
  setIssueDevMode,
} from './helpers'
import { getNextTurnIndex } from './persistence'
import {
  cleanupDomainData,
  ensureNoActiveProcess,
  killExistingSubprocessForIssue,
  syncPmState,
} from './process-ctrl'
import { MAX_AUTO_RETRIES } from './types'

// ---------- Turn completion ----------

export function handleTurnCompleted(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed || managed.state !== 'running') return
  managed.turnInFlight = false
  managed.queueCancelRequested = false
  managed.metaTurn = false
  logger.debug(
    { issueId, executionId, queued: managed.pendingInputs.length },
    'issue_turn_completed',
  )

  if (managed.pendingInputs.length > 0) {
    void flushQueuedInputs(ctx, issueId, managed)
    return
  }

  // No queued inputs — the AI turn is done and the process is idle.
  // For conversational engines the subprocess stays alive, so monitorCompletion
  // (which awaits subprocess.exited) will not fire yet. Settle the issue now:
  // update DB session status and auto-move to review.
  //
  // IMPORTANT: Do NOT change managed.state here. The subprocess is still alive
  // and can receive follow-up input. Keeping state as 'running' ensures
  // getActiveProcessForIssue() can find it, preventing duplicate process spawns.
  // The turnSettled flag tells monitorCompletion() to just clean up on exit.
  const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
  managed.turnSettled = true
  emitStateChange(ctx, issueId, executionId, finalStatus as ProcessStatus)

  void (async () => {
    try {
      await updateIssueSession(issueId, { sessionStatus: finalStatus })

      // Check for pending DB messages before moving to review.
      // If the user sent messages while the engine was busy, they were queued
      // as pending in the DB. Auto-flush them as a follow-up instead of
      // moving the issue to review, so the AI processes them in a fresh turn.
      const pendingRows = await getPendingMessages(issueId)
      if (pendingRows.length > 0) {
        logger.info(
          { issueId, executionId, pendingCount: pendingRows.length },
          'auto_flush_pending_after_turn',
        )
        const prompt = pendingRows
          .map((r) => r.content)
          .filter(Boolean)
          .join('\n\n')
        const pendingIds = pendingRows.map((r) => r.id)
        try {
          const issue = await getIssueWithSession(issueId)
          await ctx.followUpIssue(issueId, prompt, issue?.model ?? undefined)
          await markPendingMessagesDispatched(pendingIds)
          return
        } catch (flushErr) {
          logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
          // Fall through to normal review flow
        }
      }

      await autoMoveToReview(issueId)
      emitIssueSettled(ctx, issueId, executionId, finalStatus)
      logger.info({ issueId, executionId, finalStatus }, 'issue_turn_settled')
    } catch (error) {
      logger.error({ issueId, executionId, error }, 'issue_turn_settle_failed')
    }
  })()
}

export async function flushQueuedInputs(
  ctx: EngineContext,
  issueId: string,
  managed: ManagedProcess,
): Promise<void> {
  if (managed.state !== 'running' || managed.turnInFlight) return
  const next = managed.pendingInputs.shift()
  if (!next) return
  logger.debug(
    {
      issueId,
      executionId: managed.executionId,
      remainingQueue: managed.pendingInputs.length,
      promptChars: next.prompt.length,
    },
    'issue_queue_flush_next_input',
  )

  if (next.model) {
    await updateIssueSession(issueId, { model: next.model })
  }
  sendInputToRunningProcess(ctx, issueId, managed, next.prompt, next.displayPrompt, next.metadata)
}

// ---------- Settle ----------

/** Common settle flow: persist status, auto-move, clean domain data, emit event. */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  await updateIssueSession(issueId, { sessionStatus: status })
  await autoMoveToReview(issueId)
  cleanupDomainData(ctx, executionId)
  emitIssueSettled(ctx, issueId, executionId, status)
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
        permissionMode: opts.permissionMode as any,
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
        permissionMode: opts.permissionMode as any,
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
      permissionMode: opts.permissionMode as any,
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

  const filterRules = await loadFilterRules()
  const normalizer = executor.createNormalizer
    ? executor.createNormalizer(filterRules)
    : { parse: (line: string) => executor.normalizeLog(line) }

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
    const candidatePath = join(baseDir, '.bitk-worktrees', issueId)
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

  const filterRules = await loadFilterRules()
  const normalizer = executor.createNormalizer
    ? executor.createNormalizer(filterRules)
    : { parse: (line: string) => executor.normalizeLog(line) }

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
