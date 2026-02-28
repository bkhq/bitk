import type { EngineType, PermissionPolicy } from '../types'
import type { EngineContext } from './context'
import { logger } from '../../logger'
import { getIssueWithSession, updateIssueSession } from '../engine-store'
import { engineRegistry } from '../executors'
import { loadFilterRules } from '../write-filter'
import { getPidFromManaged, getPidFromSubprocess } from './context'
import { persistUserMessage, register, sendInputToRunningProcess } from './entry-handlers'
import {
  captureBaseCommitHash,
  createWorktree,
  getPermissionOptions,
  resolveWorkingDir,
  setIssueDevMode,
} from './helpers'
import {
  handleTurnCompleted,
  monitorCompletion,
  spawnFollowUpProcess,
  spawnFresh,
} from './lifecycle'
import { getNextTurnIndex } from './persistence'
import {
  cancel,
  ensureNoActiveProcess,
  getActiveProcesses,
  getActiveProcessForIssue,
  withIssueLock,
} from './process-ctrl'

// ---------- Public orchestration methods ----------

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
      const { getEngineDefaultModel } = await import('../../db/helpers')
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

    const filterRules = await loadFilterRules()
    const normalizer = executor.createNormalizer
      ? executor.createNormalizer(filterRules)
      : { parse: (line: string) => executor.normalizeLog(line) }

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
      { issueId, model, permissionMode, busyAction, promptChars: prompt.length },
      'issue_followup_requested',
    )
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)
    setIssueDevMode(issueId, issue.devMode)

    if (!issue.sessionFields.externalSessionId)
      throw new Error('No external session ID for follow-up')
    if (!issue.sessionFields.engineType) throw new Error('No engine type set on issue')

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
        active.pendingInputs.push({
          prompt,
          model: effectiveModel,
          permissionMode,
          busyAction,
          displayPrompt,
          metadata,
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

        if (busyAction === 'cancel' && active.state === 'running' && !active.queueCancelRequested) {
          active.queueCancelRequested = true
          logger.debug(
            {
              issueId,
              executionId: active.executionId,
              pid: getPidFromManaged(active),
              queued: active.pendingInputs.length,
            },
            'issue_followup_queue_requested_cancel_current',
          )
          void cancel(ctx, active.executionId, { emitCancelledState: false }).catch((error) => {
            logger.warn({ issueId, executionId: active.executionId, error }, 'queue_cancel_failed')
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

    logger.debug({ issueId, engineType, model: effectiveModel }, 'issue_followup_spawn_new_process')
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
            permissionMode: spawnOpts.permissionMode as any,
          },
          { vars: {}, workingDir, projectId: issue.projectId, issueId },
        )
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
      worktreePath,
      false,
      () => handleTurnCompleted(ctx, issueId, executionId),
    )
    monitorCompletion(ctx, executionId, issueId, engineType, false)

    return { executionId }
  })
}

export async function cancelIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<'interrupted' | 'cancelled'> {
  return withIssueLock(ctx, issueId, async () => {
    logger.info({ issueId }, 'issue_cancel_requested')
    const active = getActiveProcesses(ctx).filter((p) => p.issueId === issueId)
    for (const p of active) {
      logger.debug(
        { issueId, executionId: p.executionId, pid: getPidFromManaged(p) },
        'issue_cancel_active_process',
      )
      p.pendingInputs = []
      p.queueCancelRequested = false
      await cancel(ctx, p.executionId, { emitCancelledState: false, hard: false })
    }
    if (active.length > 0) {
      // Persist cancelled immediately so process restarts/stale cleanup
      // cannot flip this user-initiated cancel into failed.
      await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
      logger.info({ issueId, interruptedCount: active.length }, 'issue_cancel_soft_interrupted')
      return 'interrupted'
    }
    await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
    logger.info({ issueId, cancelledCount: 0 }, 'issue_cancel_completed')
    return 'cancelled'
  })
}

export async function restartStaleSessions(): Promise<number> {
  const { cleanupStaleSessions } = await import('../../db/helpers')
  return cleanupStaleSessions()
}
