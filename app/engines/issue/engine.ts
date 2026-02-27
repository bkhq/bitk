import type {
  EngineType,
  NormalizedLogEntry,
  PermissionPolicy,
  ProcessStatus,
  SpawnedProcess,
} from '../types'
import type { StreamCallbacks } from './streams'
import type {
  IssueSettledCallback,
  LogCallback,
  ManagedProcess,
  StateChangeCallback,
  UnsubscribeFn,
} from './types'
import { applyAutoTitle } from './title'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { getPendingMessages, markPendingMessagesDispatched } from '../../db/pending-messages'
import { issues as issuesTable, issueLogs as logsTable } from '../../db/schema'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '../engine-store'
import { engineRegistry } from '../executors'
import { loadFilterRules } from '../write-filter'
import {
  captureBaseCommitHash,
  createWorktree,
  getIssueDevMode,
  getPermissionOptions,
  isMissingExternalSessionError,
  isVisibleForMode,
  resolveWorkingDir,
  setIssueDevMode,
} from './helpers'
import {
  buildToolDetail,
  getLogsFromDb,
  getNextTurnIndex,
  persistLogEntry,
  persistToolDetail,
} from './persistence'
import { consumeStderr, consumeStream } from './streams'
import {
  AUTO_CLEANUP_DELAY_MS,
  GC_INTERVAL_MS,
  MAX_AUTO_RETRIES,
  MAX_CONCURRENT_EXECUTIONS,
  MAX_LOG_ENTRIES,
} from './types'

// ---------- IssueEngine ----------

export class IssueEngine {
  private processes = new Map<string, ManagedProcess>()
  private issueActiveExecution = new Map<string, string>()
  private issueOpLocks = new Map<string, Promise<void>>()
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private entryCounters = new Map<string, number>()
  private turnIndexes = new Map<string, number>()
  private userMessageIds = new Map<string, string>()

  private logCallbacks = new Map<number, LogCallback>()
  private stateChangeCallbacks = new Map<number, StateChangeCallback>()
  private issueSettledCallbacks = new Map<number, IssueSettledCallback>()
  private nextCallbackId = 0
  private gcTimer: ReturnType<typeof setInterval>

  constructor() {
    this.gcTimer = setInterval(() => this.gcSweep(), GC_INTERVAL_MS)
    // Allow the process to exit without waiting for the GC timer
    if (this.gcTimer && typeof this.gcTimer === 'object' && 'unref' in this.gcTimer) {
      this.gcTimer.unref()
    }
  }

  private getPidFromManaged(managed: ManagedProcess): number | undefined {
    return this.getPidFromSubprocess(managed.process.subprocess)
  }

  private getPidFromSubprocess(subprocess: SpawnedProcess['subprocess']): number | undefined {
    const maybePid = (subprocess as { pid?: number }).pid
    return typeof maybePid === 'number' ? maybePid : undefined
  }

  private isProcessActive(p: ManagedProcess): boolean {
    return (
      p.state === 'running' || p.state === 'spawning' || (p.state === 'cancelled' && !p.finishedAt)
    )
  }

  // ---- Orchestration ----

  async executeIssue(
    issueId: string,
    opts: {
      engineType: EngineType
      prompt: string
      workingDir?: string
      model?: string
      permissionMode?: PermissionPolicy
    },
  ): Promise<{ executionId: string; messageId?: string | null }> {
    return this.withIssueLock(issueId, async () => {
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

      this.ensureNoActiveProcess(issueId)
      this.ensureConcurrencyLimit()

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
          pid: this.getPidFromSubprocess(spawned.subprocess),
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

      this.register(
        executionId,
        issueId,
        spawned,
        (line) => normalizer.parse(line),
        0,
        worktreePath,
      )
      const messageId = this.persistUserMessage(issueId, executionId, opts.prompt)
      this.monitorCompletion(executionId, issueId, opts.engineType, false)

      return { executionId, messageId }
    })
  }

  async followUpIssue(
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionPolicy,
    busyAction: 'queue' | 'cancel' = 'queue',
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ executionId: string; messageId?: string | null }> {
    return this.withIssueLock(issueId, async () => {
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

      const active = this.getActiveProcessForIssue(issueId)
      if (active) {
        await updateIssueSession(issueId, { sessionStatus: 'running' })
        logger.debug(
          {
            issueId,
            executionId: active.executionId,
            pid: this.getPidFromManaged(active),
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
              pid: this.getPidFromManaged(active),
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
            active.queueCancelRequested = true
            logger.debug(
              {
                issueId,
                executionId: active.executionId,
                pid: this.getPidFromManaged(active),
                queued: active.pendingInputs.length,
              },
              'issue_followup_queue_requested_cancel_current',
            )
            void this.cancel(active.executionId, { emitCancelledState: false }).catch((error) => {
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
          const msgId = this.sendInputToRunningProcess(
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
              pid: this.getPidFromManaged(active),
              error: error instanceof Error ? error.message : String(error),
            },
            'issue_followup_active_send_failed_fallback_spawn',
          )
          return this.spawnFollowUpProcess(
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
      return this.spawnFollowUpProcess(
        issueId,
        prompt,
        effectiveModel,
        permissionMode,
        displayPrompt,
        metadata,
      )
    })
  }

  async restartIssue(issueId: string): Promise<{ executionId: string }> {
    return this.withIssueLock(issueId, async () => {
      const issue = await getIssueWithSession(issueId)
      if (!issue) throw new Error(`Issue not found: ${issueId}`)

      const status = issue.sessionFields.sessionStatus
      if (status !== 'failed' && status !== 'cancelled')
        throw new Error(`Cannot restart issue in session status: ${status}`)

      if (!issue.sessionFields.engineType) throw new Error('No engine type set on issue')
      if (!issue.sessionFields.prompt) throw new Error('No prompt set on issue')

      this.ensureNoActiveProcess(issueId)
      this.ensureConcurrencyLimit()

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
        : await this.spawnFresh(executor, issueId, spawnOpts)

      const filterRules = await loadFilterRules()
      const normalizer = executor.createNormalizer
        ? executor.createNormalizer(filterRules)
        : { parse: (line: string) => executor.normalizeLog(line) }

      const turnIndex = getNextTurnIndex(issueId)
      this.register(
        executionId,
        issueId,
        spawned,
        (line) => normalizer.parse(line),
        turnIndex,
        worktreePath,
      )
      this.monitorCompletion(executionId, issueId, engineType, false)

      return { executionId }
    })
  }

  async cancelIssue(issueId: string): Promise<'interrupted' | 'cancelled'> {
    return this.withIssueLock(issueId, async () => {
      logger.info({ issueId }, 'issue_cancel_requested')
      const active = this.getActiveProcesses().filter((p) => p.issueId === issueId)
      for (const p of active) {
        logger.debug(
          { issueId, executionId: p.executionId, pid: this.getPidFromManaged(p) },
          'issue_cancel_active_process',
        )
        p.pendingInputs = []
        p.queueCancelRequested = false
        await this.cancel(p.executionId, { emitCancelledState: false, hard: false })
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

  async restartStaleSessions(): Promise<number> {
    const { cleanupStaleSessions } = await import('../../db/helpers')
    return cleanupStaleSessions()
  }

  // ---- Process queries ----

  getLogs(issueId: string, devMode = false): NormalizedLogEntry[] {
    setIssueDevMode(issueId, devMode)
    // DB pre-filters by visible + entryType; isVisibleForMode() handles subtype rules.
    const persisted = getLogsFromDb(issueId, devMode)

    // While a process is active, merge any in-memory tail not yet persisted.
    const active = this.getActiveProcessForIssue(issueId)
    if (!active || active.logs.length === 0) {
      return persisted
    }

    const seen = new Set(
      persisted.map((entry) =>
        entry.messageId
          ? `id:${entry.messageId}`
          : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`,
      ),
    )

    const merged = [...persisted]
    for (const entry of active.logs) {
      if (!isVisibleForMode(entry, devMode)) continue
      const key = entry.messageId
        ? `id:${entry.messageId}`
        : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(entry)
    }

    return merged
  }

  getProcess(executionId: string): ManagedProcess | undefined {
    return this.processes.get(executionId)
  }

  /**
   * Check whether a given issue has an active (running/spawning) process.
   * Used by the reconciler to avoid moving genuinely active issues.
   */
  hasActiveProcessForIssue(issueId: string): boolean {
    return this.getActiveProcessForIssue(issueId) !== undefined
  }

  /**
   * Check whether the engine is actively processing a turn for the given issue.
   * Returns true when an active process exists AND a turn is in-flight.
   * Used by the follow-up route to decide whether to queue messages as pending.
   */
  isTurnInFlight(issueId: string): boolean {
    const active = this.getActiveProcessForIssue(issueId)
    return !!active && active.turnInFlight
  }

  getSlashCommands(issueId: string): string[] {
    const active = this.getActiveProcessForIssue(issueId)
    return active?.slashCommands ?? []
  }

  async cancelAll(): Promise<void> {
    const active = this.getActiveProcesses()
    await Promise.all(active.map((p) => this.cancel(p.executionId, { hard: true })))
  }

  // ---- Event subscriptions ----

  onLog(cb: LogCallback): UnsubscribeFn {
    const id = this.nextCallbackId++
    this.logCallbacks.set(id, cb)
    return () => {
      this.logCallbacks.delete(id)
    }
  }

  onStateChange(cb: StateChangeCallback): UnsubscribeFn {
    const id = this.nextCallbackId++
    this.stateChangeCallbacks.set(id, cb)
    return () => {
      this.stateChangeCallbacks.delete(id)
    }
  }

  onIssueSettled(cb: IssueSettledCallback): UnsubscribeFn {
    const id = this.nextCallbackId++
    this.issueSettledCallbacks.set(id, cb)
    return () => {
      this.issueSettledCallbacks.delete(id)
    }
  }

  // ---- Private: process management (absorbed from ProcessManager) ----

  private register(
    executionId: string,
    issueId: string,
    process: SpawnedProcess,
    logParser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
    turnIndex = 0,
    worktreePath?: string,
    metaTurn = false,
  ): ManagedProcess {
    const managed: ManagedProcess = {
      executionId,
      issueId,
      process,
      state: 'running',
      startedAt: new Date(),
      logs: [],
      retryCount: 0,
      turnInFlight: true,
      queueCancelRequested: false,
      logicalFailure: false,
      cancelledByUser: false,
      turnSettled: false,
      metaTurn,
      slashCommands: [],
      worktreePath,
      pendingInputs: [],
    }

    this.processes.set(executionId, managed)
    this.issueActiveExecution.set(issueId, executionId)
    this.entryCounters.set(executionId, 0)
    this.turnIndexes.set(executionId, turnIndex)
    this.emitStateChange(issueId, executionId, 'running')

    const stdoutCallbacks: StreamCallbacks = {
      getManaged: () => this.processes.get(executionId),
      getTurnIndex: () => this.turnIndexes.get(executionId) ?? 0,
      onEntry: (entry) => this.handleStreamEntry(issueId, executionId, entry),
      onTurnCompleted: () => this.handleTurnCompleted(issueId, executionId),
      onStreamError: (error) => this.handleStreamError(issueId, executionId, error),
    }
    const stderrCallbacks = {
      getManaged: () => this.processes.get(executionId),
      getTurnIndex: () => this.turnIndexes.get(executionId) ?? 0,
      onEntry: (entry: NormalizedLogEntry) => this.handleStderrEntry(issueId, executionId, entry),
    }

    consumeStream(executionId, issueId, process.stdout, logParser, stdoutCallbacks)
    consumeStderr(executionId, issueId, process.stderr, stderrCallbacks)
    logger.debug(
      { issueId, executionId, pid: this.getPidFromManaged(managed), turnIndex },
      'issue_process_registered',
    )

    return managed
  }

  private getActiveProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter((p) => this.isProcessActive(p))
  }

  private getActiveProcessForIssue(issueId: string): ManagedProcess | undefined {
    const indexedExecutionId = this.issueActiveExecution.get(issueId)
    if (indexedExecutionId) {
      const managed = this.processes.get(indexedExecutionId)
      if (managed && this.isProcessActive(managed)) {
        return managed
      }
      this.issueActiveExecution.delete(issueId)
    }

    const discovered = this.getActiveProcesses().find((p) => p.issueId === issueId)
    if (discovered) {
      this.issueActiveExecution.set(issueId, discovered.executionId)
    }
    return discovered
  }

  private async withIssueLock<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.issueOpLocks.get(issueId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const newTail = tail.then(() => gate)
    this.issueOpLocks.set(issueId, newTail)

    await tail
    try {
      return await fn()
    } finally {
      release()
      if (this.issueOpLocks.get(issueId) === newTail) {
        this.issueOpLocks.delete(issueId)
      }
    }
  }

  private async cancel(
    executionId: string,
    opts: { emitCancelledState?: boolean; hard?: boolean } = {},
  ): Promise<void> {
    const managed = this.processes.get(executionId)
    if (!managed || managed.state !== 'running') return

    logger.debug(
      {
        issueId: managed.issueId,
        executionId,
        pid: this.getPidFromManaged(managed),
        emitCancelledState: opts.emitCancelledState !== false,
        hard: opts.hard === true,
      },
      'issue_process_cancel_start',
    )

    managed.process.cancel()

    // Soft cancel: interrupt current turn only and keep process alive.
    if (!opts.hard) {
      managed.cancelledByUser = true
      logger.debug(
        { issueId: managed.issueId, executionId, pid: this.getPidFromManaged(managed) },
        'issue_process_interrupt_sent',
      )
      return
    }

    managed.state = 'cancelled'
    if (opts.emitCancelledState !== false) {
      this.emitStateChange(managed.issueId, executionId, 'cancelled')
    }

    const killTimeout = setTimeout(() => {
      try {
        managed.process.subprocess.kill(9)
      } catch {
        /* already dead */
      }
    }, 5000)

    try {
      await managed.process.subprocess.exited
    } catch {
      /* ignore */
    } finally {
      clearTimeout(killTimeout)
      managed.finishedAt = new Date()
      logger.debug(
        { issueId: managed.issueId, executionId, pid: this.getPidFromManaged(managed) },
        'issue_process_cancel_finished',
      )
    }
  }

  private ensureNoActiveProcess(issueId: string): void {
    const active = this.getActiveProcessForIssue(issueId)
    if (active) {
      throw new Error(
        `Issue ${issueId} already has an active process (${active.executionId}). Cancel it first or wait for completion.`,
      )
    }
  }

  /** Kill any existing subprocess for this issue (regardless of managed state).
   *  Used as a safety guard before spawning a new follow-up process to prevent
   *  duplicate CLI processes for the same session. */
  private async killExistingSubprocessForIssue(issueId: string): Promise<void> {
    for (const [executionId, managed] of this.processes) {
      if (managed.issueId !== issueId || managed.finishedAt) continue
      try {
        managed.process.subprocess.kill()
        logger.debug(
          { issueId, executionId, pid: this.getPidFromManaged(managed) },
          'issue_killed_existing_subprocess_before_followup_spawn',
        )
        // Wait briefly for clean exit, then force kill
        const killTimeout = setTimeout(() => {
          try {
            managed.process.subprocess.kill(9)
          } catch {
            /* already dead */
          }
        }, 3000)
        try {
          await managed.process.subprocess.exited
        } catch {
          /* ignore */
        } finally {
          clearTimeout(killTimeout)
        }
      } catch {
        /* subprocess already dead — ignore */
      }
      managed.finishedAt = new Date()
      this.scheduleAutoCleanup(executionId)
    }
  }

  private cleanup(executionId: string): void {
    const managed = this.processes.get(executionId)
    const timer = this.cleanupTimers.get(executionId)
    if (timer) {
      clearTimeout(timer)
      this.cleanupTimers.delete(executionId)
    }
    if (managed && this.issueActiveExecution.get(managed.issueId) === executionId) {
      this.issueActiveExecution.delete(managed.issueId)
    }
    this.processes.delete(executionId)
    this.entryCounters.delete(executionId)
    this.turnIndexes.delete(executionId)
  }

  private scheduleAutoCleanup(executionId: string): void {
    const existing = this.cleanupTimers.get(executionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => this.cleanup(executionId), AUTO_CLEANUP_DELAY_MS)
    this.cleanupTimers.set(executionId, timer)
  }

  // ---- Private: stream entry handlers ----

  private persistEntry(
    issueId: string,
    executionId: string,
    entry: NormalizedLogEntry,
  ): NormalizedLogEntry | null {
    const idx = this.entryCounters.get(executionId) ?? 0
    const turnIdx = this.turnIndexes.get(executionId) ?? 0
    const replyTo =
      entry.entryType !== 'user-message'
        ? (this.userMessageIds.get(`${issueId}:${turnIdx}`) ?? null)
        : null
    const persisted = persistLogEntry(issueId, executionId, entry, idx, turnIdx, replyTo)
    if (persisted) {
      this.entryCounters.set(executionId, idx + 1)
    }
    return persisted
  }

  private handleStreamEntry(issueId: string, executionId: string, entry: NormalizedLogEntry): void {
    const managed = this.processes.get(executionId)
    if (!managed) return

    // Intercept auto-title pattern from AI response in meta turns
    if (managed.metaTurn && entry.entryType === 'assistant-message') {
      applyAutoTitle(issueId, entry.content)
    }

    // Persist first, then emit (DB is source of truth)
    // For tool-use entries, content & metadata are stored in the tools table only
    const isToolUse = entry.entryType === 'tool-use'
    const dbEntry = isToolUse ? { ...entry, content: '', metadata: undefined } : entry
    const persisted = this.persistEntry(issueId, executionId, dbEntry)
    if (persisted) {
      if (isToolUse && persisted.messageId) {
        const detail = buildToolDetail(entry)
        if (detail) persisted.toolDetail = detail
        // Restore content/metadata on the in-memory entry for emitting to live clients
        persisted.content = entry.content
        persisted.metadata = entry.metadata
        const toolRecordId = persistToolDetail(persisted.messageId, issueId, entry)
        if (toolRecordId) {
          db.update(logsTable)
            .set({ toolCallRefId: toolRecordId })
            .where(eq(logsTable.id, persisted.messageId))
            .run()
        }
      }
      // Push persisted entry (with messageId) so getLogs dedup works correctly
      if (managed.logs.length < MAX_LOG_ENTRIES) {
        managed.logs.push(persisted)
      }
      this.emitLog(issueId, executionId, persisted)
    } else if (managed.logs.length < MAX_LOG_ENTRIES) {
      // Persist failed — keep original entry in memory as fallback
      managed.logs.push(entry)
    }

    const resultSubtype = entry.metadata?.resultSubtype
    const isResultError = typeof resultSubtype === 'string' && resultSubtype !== 'success'
    if (!managed.cancelledByUser && (isResultError || entry.metadata?.isError === true)) {
      managed.logicalFailure = true
      managed.logicalFailureReason =
        (entry.metadata?.error as string | undefined) ?? String(resultSubtype ?? 'unknown')
    }
  }

  private handleStderrEntry(issueId: string, executionId: string, entry: NormalizedLogEntry): void {
    const persisted = this.persistEntry(issueId, executionId, entry)
    if (persisted) {
      this.emitLog(issueId, executionId, persisted)
    }
  }

  private handleStreamError(issueId: string, executionId: string, error: unknown): void {
    const managed = this.processes.get(executionId)
    if (!managed) return
    const turnIdx = this.turnIndexes.get(executionId) ?? 0
    const errorEntry: NormalizedLogEntry = {
      entryType: 'error-message',
      content: error instanceof Error ? error.message : 'Stream read error',
      turnIndex: turnIdx,
      timestamp: new Date().toISOString(),
    }
    managed.logs.push(errorEntry)
    const persisted = this.persistEntry(issueId, executionId, errorEntry)
    if (persisted) {
      this.emitLog(issueId, executionId, persisted)
    }
  }

  private persistUserMessage(
    issueId: string,
    executionId: string,
    prompt: string,
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
  ): string | null {
    const turnIdx = this.turnIndexes.get(executionId) ?? 0
    // When displayPrompt is provided on a meta turn, the user wants this message visible.
    // Strip type:'system' so isVisibleForMode() won't hide it.
    let entryMeta = metadata
    if (displayPrompt && metadata?.type === 'system') {
      const { type: _type, ...rest } = metadata
      entryMeta = Object.keys(rest).length > 0 ? rest : undefined
    }
    const entry: NormalizedLogEntry = {
      entryType: 'user-message',
      content: (displayPrompt ?? prompt).trim(),
      turnIndex: turnIdx,
      timestamp: new Date().toISOString(),
      ...(entryMeta ? { metadata: entryMeta } : {}),
    }

    // Persist first, then emit (DB is source of truth)
    const persisted = this.persistEntry(issueId, executionId, entry)
    if (persisted) {
      // Push persisted (with messageId) to in-memory logs for dedup
      const managed = this.processes.get(executionId)
      if (managed) {
        managed.logs.push(persisted)
      }
      this.emitLog(issueId, executionId, persisted)
    }

    // Store user message ID so agent responses in this turn can reference it
    const messageId = persisted?.messageId ?? null
    if (messageId) {
      this.userMessageIds.set(`${issueId}:${turnIdx}`, messageId)
    }
    return messageId
  }

  private sendInputToRunningProcess(
    issueId: string,
    managed: ManagedProcess,
    prompt: string,
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
  ): string | null {
    if (managed.state !== 'running') {
      throw new Error('Cannot send input to a non-running process')
    }
    const handler = managed.process.protocolHandler
    if (!handler?.sendUserMessage) {
      throw new Error('Active process does not support interactive follow-up input')
    }

    // IMPORTANT: send to engine first, then persist.
    // If send throws (e.g. stdin closed in a race), caller may fallback to spawn
    // a new process. Persisting before send would duplicate this message across turns.
    handler.sendUserMessage(prompt)
    managed.turnInFlight = true
    managed.queueCancelRequested = false
    // Reset turn-level flags for the new turn so previous turn's state doesn't leak.
    managed.turnSettled = false
    managed.logicalFailure = false
    managed.logicalFailureReason = undefined
    managed.cancelledByUser = false
    managed.metaTurn = metadata?.type === 'system'
    // Emit running state BEFORE user message so the frontend resets doneReceivedRef
    // and accepts the subsequent user message SSE event.
    this.emitStateChange(issueId, managed.executionId, 'running')
    const messageId = this.persistUserMessage(
      issueId,
      managed.executionId,
      prompt,
      displayPrompt,
      metadata,
    )
    logger.debug(
      {
        issueId,
        executionId: managed.executionId,
        pid: this.getPidFromManaged(managed),
        promptChars: prompt.length,
        metaTurn: managed.metaTurn,
      },
      'issue_process_input_sent',
    )
    return messageId
  }

  private handleTurnCompleted(issueId: string, executionId: string): void {
    const managed = this.processes.get(executionId)
    if (!managed || managed.state !== 'running') return
    managed.turnInFlight = false
    managed.queueCancelRequested = false
    managed.metaTurn = false
    logger.debug(
      { issueId, executionId, queued: managed.pendingInputs.length },
      'issue_turn_completed',
    )

    if (managed.pendingInputs.length > 0) {
      void this.flushQueuedInputs(issueId, managed)
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
    this.emitStateChange(issueId, executionId, finalStatus as ProcessStatus)

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
            await this.followUpIssue(issueId, prompt, issue?.model ?? undefined)
            await markPendingMessagesDispatched(pendingIds)
            return
          } catch (flushErr) {
            logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
            // Fall through to normal review flow
          }
        }

        await autoMoveToReview(issueId)
        this.emitIssueSettled(issueId, executionId, finalStatus)
        logger.info({ issueId, executionId, finalStatus }, 'issue_turn_settled')
      } catch (error) {
        logger.error({ issueId, executionId, error }, 'issue_turn_settle_failed')
      }
    })()
  }

  private async flushQueuedInputs(issueId: string, managed: ManagedProcess): Promise<void> {
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
    this.sendInputToRunningProcess(issueId, managed, next.prompt, next.displayPrompt, next.metadata)
  }

  // ---- Private: completion monitoring ----

  /** Common settle flow: persist status, auto-move, schedule cleanup, emit event. */
  private async settleIssue(issueId: string, executionId: string, status: string): Promise<void> {
    await updateIssueSession(issueId, { sessionStatus: status })
    await autoMoveToReview(issueId)
    this.scheduleAutoCleanup(executionId)
    this.emitIssueSettled(issueId, executionId, status)
  }

  private monitorCompletion(
    executionId: string,
    issueId: string,
    engineType: EngineType,
    isRetry: boolean,
  ): void {
    const managed = this.processes.get(executionId)
    if (!managed) return

    void (async () => {
      try {
        const exitCode = await managed.process.subprocess.exited
        managed.exitCode = exitCode
        managed.finishedAt = new Date()
        if (this.issueActiveExecution.get(issueId) === executionId) {
          this.issueActiveExecution.delete(issueId)
        }
        logger.info(
          {
            issueId,
            executionId,
            pid: this.getPidFromManaged(managed),
            exitCode,
            queued: managed.pendingInputs.length,
            state: managed.state,
          },
          'issue_process_exited',
        )

        // If the issue was already settled by handleTurnCompleted (conversational
        // engines where the process stays alive between turns), just clean up.
        // We use the turnSettled flag instead of checking managed.state because
        // the state is now kept as 'running' while the subprocess is alive.
        if (managed.turnSettled) {
          managed.state = (managed.logicalFailure ? 'failed' : 'completed') as ProcessStatus
          managed.finishedAt = new Date()
          this.scheduleAutoCleanup(executionId)
          return
        }

        // If user queued follow-ups while process was active, continue them in order
        // using a fresh follow-up process after this one exits.
        if (managed.pendingInputs.length > 0) {
          const queued = [...managed.pendingInputs]
          managed.pendingInputs = []
          this.scheduleAutoCleanup(executionId)
          try {
            const first = queued.shift()
            if (!first) return
            const result = await this.spawnFollowUpProcess(
              issueId,
              first.prompt,
              first.model,
              first.permissionMode,
              undefined,
              first.metadata,
            )
            const nextManaged = this.processes.get(result.executionId)
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
          await this.settleIssue(issueId, executionId, 'cancelled')
          return
        }

        const logicalFailure = managed.logicalFailure
        if (exitCode === 0 && !logicalFailure) {
          managed.state = 'completed'
          this.emitStateChange(issueId, executionId, 'completed')
          await this.settleIssue(issueId, executionId, 'completed')
        } else {
          managed.state = 'failed'
          this.emitStateChange(issueId, executionId, 'failed')
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
            logger.info(
              { issueId, executionId, retryCount: managed.retryCount },
              'auto_retry_issue',
            )
            this.scheduleAutoCleanup(executionId)

            try {
              await this.spawnRetry(issueId, engineType)
            } catch (retryErr) {
              logger.error({ issueId, err: retryErr }, 'auto_retry_failed')
              await this.settleIssue(issueId, executionId, 'failed')
            }
          } else {
            await this.settleIssue(issueId, executionId, 'failed')
          }
        }
      } catch {
        managed.state = 'failed'
        managed.finishedAt = new Date()
        this.emitStateChange(issueId, executionId, 'failed')
        await this.settleIssue(issueId, executionId, 'failed')
      }
    })()
  }

  /**
   * Try spawnFollowUp; if the external session is missing, fall back to a fresh spawn.
   * Shared by spawnRetry and spawnFollowUpProcess.
   */
  private async spawnWithSessionFallback(
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
    const ctx = { vars: {}, workingDir: opts.workingDir, projectId: opts.projectId, issueId }
    try {
      return await executor.spawnFollowUp(
        {
          workingDir: opts.workingDir,
          prompt: opts.prompt,
          sessionId: opts.sessionId,
          model: opts.model,
          permissionMode: opts.permissionMode as any,
        },
        ctx,
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
        ctx,
      )
      await updateIssueSession(issueId, {
        externalSessionId: spawned.externalSessionId ?? externalSessionId,
      })
      return spawned
    }
  }

  /** Spawn a fresh process (no existing session). Shared by spawnRetry and restartIssue. */
  private async spawnFresh(
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

  private async spawnRetry(issueId: string, engineType: EngineType): Promise<void> {
    logger.debug({ issueId, engineType }, 'issue_retry_requested')
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)

    this.ensureNoActiveProcess(issueId)
    this.ensureConcurrencyLimit()

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
      ? await this.spawnWithSessionFallback(executor, issueId, {
          ...spawnOpts,
          sessionId: issue.sessionFields.externalSessionId,
        })
      : await this.spawnFresh(executor, issueId, spawnOpts)

    const filterRules = await loadFilterRules()
    const normalizer = executor.createNormalizer
      ? executor.createNormalizer(filterRules)
      : { parse: (line: string) => executor.normalizeLog(line) }

    const turnIndex = getNextTurnIndex(issueId)
    this.register(executionId, issueId, spawned, (line) => normalizer.parse(line), turnIndex)
    this.monitorCompletion(executionId, issueId, engineType, true)
    logger.debug({ issueId, executionId, engineType, turnIndex }, 'issue_retry_spawned')
  }

  private async spawnFollowUpProcess(
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

    this.ensureConcurrencyLimit()

    // Safety guard: kill any existing subprocess for this issue to prevent
    // duplicate CLI processes talking to the same Claude session.
    // This can happen if sendInputToRunningProcess() failed (stdin closed)
    // but the old subprocess is still alive.
    await this.killExistingSubprocessForIssue(issueId)

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

    const spawned = await this.spawnWithSessionFallback(executor, issueId, {
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
    const managed = this.register(
      executionId,
      issueId,
      spawned,
      (line) => normalizer.parse(line),
      turnIndex,
      worktreePath,
      metadata?.type === 'system',
    )
    const messageId = this.persistUserMessage(issueId, executionId, prompt, displayPrompt, metadata)
    this.monitorCompletion(executionId, issueId, engineType, false)
    logger.info(
      {
        issueId,
        executionId,
        pid: this.getPidFromSubprocess(spawned.subprocess),
        engineType,
        turnIndex,
        model: effectiveModel,
      },
      'issue_followup_spawned',
    )

    return { executionId, messageId }
  }

  // ---- Private: GC sweep ----

  private gcSweep(): void {
    let cleaned = 0
    for (const [executionId, managed] of this.processes) {
      // Skip processes that are still actively running
      if (this.isProcessActive(managed)) {
        continue
      }
      // Stale: finished but never cleaned up (crashed path or missed settle)
      this.cleanup(executionId)
      cleaned++
    }
    // Clean orphaned issueActiveExecution entries pointing to non-existent processes
    for (const [issueId, executionId] of this.issueActiveExecution) {
      if (!this.processes.has(executionId)) {
        this.issueActiveExecution.delete(issueId)
        cleaned++
      }
    }
    // Clean orphaned issueOpLocks (resolved promises that were never removed)
    for (const [issueId] of this.issueOpLocks) {
      if (!this.issueActiveExecution.has(issueId)) {
        this.issueOpLocks.delete(issueId)
        cleaned++
      }
    }
    // Clean orphaned userMessageIds entries for issues no longer tracked
    const activeIssueIds = new Set(Array.from(this.processes.values()).map((p) => p.issueId))
    for (const key of this.userMessageIds.keys()) {
      const issueId = key.split(':')[0] ?? key
      if (!activeIssueIds.has(issueId)) {
        this.userMessageIds.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) {
      logger.debug(
        {
          cleaned,
          remainingProcesses: this.processes.size,
          remainingActiveExecs: this.issueActiveExecution.size,
        },
        'gc_sweep_completed',
      )
    }
  }

  // ---- Private: concurrency guard ----

  private getRunningCount(): number {
    let count = 0
    for (const managed of this.processes.values()) {
      if (managed.state === 'running' || managed.state === 'spawning') {
        count++
      }
    }
    return count
  }

  private ensureConcurrencyLimit(): void {
    const running = this.getRunningCount()
    if (running >= MAX_CONCURRENT_EXECUTIONS) {
      throw new Error(
        `Global concurrency limit reached (${running}/${MAX_CONCURRENT_EXECUTIONS}). Cancel an existing execution or wait for one to complete.`,
      )
    }
  }

  // ---- Private: event emitters ----

  private emitLog(issueId: string, executionId: string, entry: NormalizedLogEntry): void {
    const devMode = getIssueDevMode(issueId)
    if (!isVisibleForMode(entry, devMode)) return
    for (const cb of this.logCallbacks.values()) {
      try {
        cb(issueId, executionId, entry)
      } catch {
        /* ignore */
      }
    }
  }

  private emitStateChange(issueId: string, executionId: string, state: ProcessStatus): void {
    for (const cb of this.stateChangeCallbacks.values()) {
      try {
        cb(issueId, executionId, state)
      } catch {
        /* ignore */
      }
    }
  }

  private emitIssueSettled(issueId: string, executionId: string, state: string): void {
    for (const cb of this.issueSettledCallbacks.values()) {
      try {
        cb(issueId, executionId, state)
      } catch {
        /* ignore */
      }
    }
  }
}

// Singleton
export const issueEngine = new IssueEngine()
