import type {
  EngineType,
  NormalizedLogEntry,
  PermissionPolicy,
  ProcessStatus,
  SpawnedProcess,
  ToolAction,
  ToolDetail,
} from './types'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { asc, eq, max } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '../db'
import { getPendingMessages, markPendingMessagesDispatched } from '../db/pending-messages'
import {
  issueLogs as logsTable,
  projects as projectsTable,
  issuesLogsToolsCall as toolsTable,
} from '../db/schema'
import { logger } from '../logger'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from './engine-store'
import { engineRegistry } from './executors'
import { normalizeStream } from './logs'
import { BUILT_IN_PROFILES } from './types'

// ---------- Internal types ----------

interface ManagedProcess {
  executionId: string
  issueId: string
  process: SpawnedProcess
  state: ProcessStatus
  startedAt: Date
  finishedAt?: Date
  exitCode?: number
  logs: NormalizedLogEntry[]
  retryCount: number
  turnInFlight: boolean
  queueCancelRequested: boolean
  logicalFailure: boolean
  logicalFailureReason?: string
  cancelledByUser: boolean
  /** True when handleTurnCompleted() has settled the issue (DB updated, events emitted)
   *  but the subprocess is still alive (conversational engines). Prevents monitorCompletion()
   *  from re-settling on exit, and is reset when a new turn starts. */
  turnSettled: boolean
  worktreePath?: string
  pendingInputs: Array<{
    prompt: string
    model?: string
    permissionMode?: PermissionPolicy
    busyAction: 'queue' | 'cancel'
  }>
}

type LogCallback = (issueId: string, executionId: string, entry: NormalizedLogEntry) => void
type StateChangeCallback = (issueId: string, executionId: string, state: ProcessStatus) => void
type IssueSettledCallback = (issueId: string, executionId: string, state: string) => void
type UnsubscribeFn = () => void

// ---------- Constants ----------

const MAX_LOG_ENTRIES = 10000
const AUTO_CLEANUP_DELAY_MS = 5 * 60 * 1000 // 5 minutes
const MAX_AUTO_RETRIES = 1
const GC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_CONCURRENT_EXECUTIONS = Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5

// ---------- Helpers ----------
function isFrontendSuppressedEntry(entry: NormalizedLogEntry): boolean {
  // Hide dispatched pending messages (pending was set to false after engine consumed them)
  if (entry.metadata?.pending === false) return true
  if (entry.entryType !== 'system-message') return false
  const subtype = entry.metadata?.subtype
  if (subtype === 'init') return true
  if (subtype === 'hook_response' && typeof entry.metadata?.hookName === 'string') {
    return entry.metadata.hookName.startsWith('SessionStart:')
  }
  return false
}

function isMissingExternalSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('no conversation found with session id') ||
    (msg.includes('no conversation found') && msg.includes('session id'))
  )
}

function getPermissionOptions(
  engineType: EngineType,
  overridePolicy?: PermissionPolicy,
): {
  permissionMode: string
} {
  const profile = BUILT_IN_PROFILES[engineType]
  const policy = overridePolicy ?? profile?.permissionPolicy ?? 'supervised'

  return { permissionMode: policy }
}

async function resolveWorkingDir(projectId: string): Promise<string> {
  const [project] = await db
    .select({ directory: projectsTable.directory })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  const dir = project?.directory ? resolve(project.directory) : process.cwd()
  await mkdir(dir, { recursive: true })
  const s = await stat(dir)
  if (!s.isDirectory()) {
    throw new Error(`Project directory is not a directory: ${dir}`)
  }
  return dir
}

async function captureBaseCommitHash(workingDir: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: workingDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) return null
    const hash = stdout.trim()
    if (!/^[0-9a-f]{40}$/i.test(hash)) return null
    return hash
  } catch {
    return null
  }
}

// ---------- Git worktree helpers ----------

async function createWorktree(baseDir: string, issueId: string): Promise<string> {
  const branchName = `bitk/${issueId}`
  const worktreeDir = join(baseDir, '.bitk-worktrees', issueId)
  await mkdir(join(baseDir, '.bitk-worktrees'), { recursive: true })

  // Create worktree with a new branch off HEAD
  const proc = Bun.spawn(['git', 'worktree', 'add', '-b', branchName, worktreeDir], {
    cwd: baseDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    // Branch may already exist from a previous run — try without -b
    const retry = Bun.spawn(['git', 'worktree', 'add', worktreeDir, branchName], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const retryCode = await retry.exited
    if (retryCode !== 0) {
      const retryErr = await new Response(retry.stderr).text()
      throw new Error(`Failed to create worktree: ${stderr.trim()} / ${retryErr.trim()}`)
    }
  }
  logger.debug({ issueId, worktreeDir, branchName }, 'worktree_created')
  return worktreeDir
}

export async function removeWorktree(baseDir: string, worktreeDir: string): Promise<void> {
  try {
    const proc = Bun.spawn(['git', 'worktree', 'remove', '--force', worktreeDir], {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await proc.exited
    logger.debug({ worktreeDir }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir, error }, 'worktree_remove_failed')
    // Fallback: just delete the directory
    try {
      await rm(worktreeDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

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

      this.ensureNoActiveProcess(issueId)
      this.ensureConcurrencyLimit()

      const executor = engineRegistry.get(opts.engineType)
      if (!executor) throw new Error(`No executor for engine type: ${opts.engineType}`)

      let model = opts.model
      if (!model) {
        const { getEngineDefaultModel } = await import('../db/helpers')
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

      this.register(
        executionId,
        issueId,
        spawned,
        (line) => executor.normalizeLog(line),
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
          active.pendingInputs.push({ prompt, model: effectiveModel, permissionMode, busyAction })
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

      let spawned: SpawnedProcess

      if (issue.sessionFields.externalSessionId) {
        // Has an existing session — use follow-up with the original prompt
        spawned = await executor.spawnFollowUp(
          {
            workingDir,
            prompt: issue.sessionFields.prompt,
            sessionId: issue.sessionFields.externalSessionId,
            model: issue.sessionFields.model ?? undefined,
            permissionMode: permOptions.permissionMode as any,
          },
          {
            vars: {},
            workingDir,
            projectId: issue.projectId,
            issueId,
          },
        )
      } else {
        // No session yet — spawn fresh
        const externalSessionId = crypto.randomUUID()
        spawned = await executor.spawn(
          {
            workingDir,
            prompt: issue.sessionFields.prompt,
            model: issue.sessionFields.model ?? undefined,
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
        await updateIssueSession(issueId, {
          externalSessionId: spawned.externalSessionId ?? externalSessionId,
        })
      }

      const turnIndex = this.getNextTurnIndex(issueId)
      this.register(
        executionId,
        issueId,
        spawned,
        (line) => executor.normalizeLog(line),
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
    const { cleanupStaleSessions } = await import('../db/helpers')
    return cleanupStaleSessions()
  }

  // ---- Process queries ----

  getLogs(issueId: string): NormalizedLogEntry[] {
    // Always use DB as source of truth so history across all turns remains complete.
    const persisted = this.getLogsFromDb(issueId).filter(
      (entry) => !isFrontendSuppressedEntry(entry),
    )

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
      if (isFrontendSuppressedEntry(entry)) continue
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
      worktreePath,
      pendingInputs: [],
    }

    this.processes.set(executionId, managed)
    this.issueActiveExecution.set(issueId, executionId)
    this.entryCounters.set(executionId, 0)
    this.turnIndexes.set(executionId, turnIndex)
    this.emitStateChange(issueId, executionId, 'running')

    this.consumeStream(executionId, issueId, process.stdout, logParser)
    this.consumeStderr(executionId, issueId, process.stderr)
    logger.debug(
      { issueId, executionId, pid: this.getPidFromManaged(managed), turnIndex },
      'issue_process_registered',
    )

    return managed
  }

  private getActiveProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) =>
        p.state === 'running' ||
        p.state === 'spawning' ||
        (p.state === 'cancelled' && !p.finishedAt),
    )
  }

  private getActiveProcessForIssue(issueId: string): ManagedProcess | undefined {
    const indexedExecutionId = this.issueActiveExecution.get(issueId)
    if (indexedExecutionId) {
      const managed = this.processes.get(indexedExecutionId)
      if (
        managed &&
        (managed.state === 'running' ||
          managed.state === 'spawning' ||
          (managed.state === 'cancelled' && !managed.finishedAt))
      ) {
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

    const timer = setTimeout(() => {
      const managed = this.processes.get(executionId)
      if (managed && this.issueActiveExecution.get(managed.issueId) === executionId) {
        this.issueActiveExecution.delete(managed.issueId)
      }
      this.cleanupTimers.delete(executionId)
      this.processes.delete(executionId)
      this.entryCounters.delete(executionId)
      this.turnIndexes.delete(executionId)
    }, AUTO_CLEANUP_DELAY_MS)

    this.cleanupTimers.set(executionId, timer)
  }

  // ---- Private: log persistence ----

  private persistLogEntry(
    issueId: string,
    executionId: string,
    entry: NormalizedLogEntry,
  ): NormalizedLogEntry | null {
    try {
      const messageId = entry.messageId ?? ulid()
      const idx = this.entryCounters.get(executionId) ?? 0
      this.entryCounters.set(executionId, idx + 1)
      const turnIdx = this.turnIndexes.get(executionId) ?? 0

      // For non-user-message entries, link back to the user message that started this turn
      let replyToMessageId: string | null = null
      if (entry.entryType !== 'user-message') {
        const replyTo = this.userMessageIds.get(`${issueId}:${turnIdx}`)
        if (replyTo) {
          replyToMessageId = replyTo
        }
      }

      db.insert(logsTable)
        .values({
          id: messageId,
          issueId,
          turnIndex: turnIdx,
          entryIndex: idx,
          entryType: entry.entryType,
          content: entry.content.trim(),
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          replyToMessageId,
          timestamp: entry.timestamp ?? null,
        })
        .run()

      // Return new object — do NOT mutate the input entry
      return {
        ...entry,
        messageId,
        replyToMessageId: replyToMessageId ?? undefined,
      }
    } catch (error) {
      logger.warn({ err: error, issueId }, 'persistLogEntry failed')
      return null
    }
  }

  private persistToolDetail(
    logId: string,
    issueId: string,
    entry: NormalizedLogEntry,
  ): string | null {
    try {
      const toolName =
        typeof entry.metadata?.toolName === 'string'
          ? entry.metadata.toolName
          : (entry.toolAction?.kind ?? 'unknown')
      const toolCallId =
        typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : null
      const isResult = entry.metadata?.isResult === true
      const action = entry.toolAction
      const kind = action?.kind ?? 'other'

      // Build raw JSON from all available data
      const rawData: Record<string, unknown> = {
        toolName,
        toolCallId,
        kind,
        isResult,
      }
      if (action) rawData.toolAction = action
      if (entry.metadata) rawData.metadata = entry.metadata
      if (entry.content) {
        const content = entry.content
        rawData.content =
          content.length > 5000 ? `${content.slice(0, 5000)}...[truncated]` : content
      }

      const toolRecordId = ulid()

      db.insert(toolsTable)
        .values({
          id: toolRecordId,
          logId,
          issueId,
          toolName,
          toolCallId,
          kind,
          isResult,
          raw: JSON.stringify(rawData),
        })
        .run()

      return toolRecordId
    } catch (error) {
      logger.warn({ err: error, logId, issueId }, 'persistToolDetail failed')
      return null
    }
  }

  private buildToolDetail(entry: NormalizedLogEntry): ToolDetail | null {
    if (entry.entryType !== 'tool-use') return null
    const toolName =
      typeof entry.metadata?.toolName === 'string'
        ? entry.metadata.toolName
        : (entry.toolAction?.kind ?? 'unknown')
    const action = entry.toolAction
    const kind = action?.kind ?? 'other'
    const isResult = entry.metadata?.isResult === true

    return {
      kind,
      toolName,
      toolCallId:
        typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : undefined,
      isResult,
    }
  }

  private getLogsFromDb(issueId: string): NormalizedLogEntry[] {
    const rows = db
      .select()
      .from(logsTable)
      .where(eq(logsTable.issueId, issueId))
      .orderBy(asc(logsTable.turnIndex), asc(logsTable.entryIndex))
      .limit(MAX_LOG_ENTRIES)
      .all()

    // Batch-fetch tool details for this issue (bounded by log count)
    const toolRows = db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.issueId, issueId))
      .limit(MAX_LOG_ENTRIES)
      .all()
    const toolByLogId = new Map(toolRows.map((r) => [r.logId, r]))

    return rows.map((row) => {
      const base: NormalizedLogEntry = {
        messageId: row.id,
        replyToMessageId: row.replyToMessageId ?? undefined,
        entryType: row.entryType as NormalizedLogEntry['entryType'],
        content: row.content.trim(),
        turnIndex: row.turnIndex,
        timestamp: row.timestamp ?? undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }

      // Attach tool detail and reconstruct toolAction + content/metadata from tools table
      const tool = toolByLogId.get(row.id)
      if (tool) {
        const rawData = tool.raw ? JSON.parse(tool.raw) : {}
        base.toolDetail = {
          kind: tool.kind,
          toolName: tool.toolName,
          toolCallId: tool.toolCallId ?? undefined,
          isResult: tool.isResult ?? false,
          raw: rawData,
        }
        base.toolAction = this.rawToToolAction(tool.kind, rawData)
        // Restore content & metadata from raw (not stored in issues_logs for tool-use)
        if (!base.content && rawData.content) {
          base.content = rawData.content as string
        }
        if (!base.metadata && rawData.metadata) {
          base.metadata = rawData.metadata as Record<string, unknown>
        }
      }

      return base
    })
  }

  /** Reconstruct ToolAction from the raw JSON stored in issue_logs_tools_call */
  private rawToToolAction(kind: string, rawData: Record<string, unknown>): ToolAction {
    const action = rawData.toolAction as Record<string, unknown> | undefined
    switch (kind) {
      case 'file-read':
        return { kind: 'file-read', path: (action?.path as string) ?? '' }
      case 'file-edit':
        return { kind: 'file-edit', path: (action?.path as string) ?? '' }
      case 'command-run':
        return { kind: 'command-run', command: (action?.command as string) ?? '' }
      case 'search':
        return { kind: 'search', query: (action?.query as string) ?? '' }
      case 'web-fetch':
        return { kind: 'web-fetch', url: (action?.url as string) ?? '' }
      case 'tool':
        return {
          kind: 'tool',
          toolName: (action?.toolName as string) ?? (rawData.toolName as string) ?? '',
        }
      default:
        return { kind: 'other', description: (rawData.toolName as string) ?? kind }
    }
  }

  private getNextTurnIndex(issueId: string): number {
    const [row] = db
      .select({ maxTurn: max(logsTable.turnIndex) })
      .from(logsTable)
      .where(eq(logsTable.issueId, issueId))
      .all()
    return (row?.maxTurn ?? -1) + 1
  }

  private persistUserMessage(
    issueId: string,
    executionId: string,
    prompt: string,
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
  ): string | null {
    const turnIdx = this.turnIndexes.get(executionId) ?? 0
    const entry: NormalizedLogEntry = {
      entryType: 'user-message',
      content: (displayPrompt ?? prompt).trim(),
      turnIndex: turnIdx,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    }

    // Persist first, then emit (DB is source of truth)
    const persisted = this.persistLogEntry(issueId, executionId, entry)
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
      },
      'issue_process_input_sent',
    )
    this.emitStateChange(issueId, managed.executionId, 'running')
    return messageId
  }

  // ---- Private: stream consumers ----

  private async consumeStream(
    executionId: string,
    issueId: string,
    stream: ReadableStream<Uint8Array>,
    parser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  ): Promise<void> {
    try {
      for await (const rawEntry of normalizeStream(stream, parser)) {
        const managed = this.processes.get(executionId)
        if (!managed) break
        const turnIdx = this.turnIndexes.get(executionId) ?? 0

        const entry = {
          ...rawEntry,
          turnIndex: turnIdx,
          timestamp: rawEntry.timestamp ?? new Date().toISOString(),
        }

        // Claude may emit execution noise after interrupt (e.g. request aborted /
        // rust-analyzer crash). If this turn was user-cancelled, suppress it.
        if (managed.cancelledByUser && this.isCancelledNoiseEntry(entry)) {
          if (this.isTurnCompletionEntry(entry)) {
            this.handleTurnCompleted(issueId, executionId)
          }
          continue
        }
        // Persist first, then emit (DB is source of truth)
        // For tool-use entries, content & metadata are stored in the tools table only
        const isToolUse = entry.entryType === 'tool-use'
        const dbEntry = isToolUse ? { ...entry, content: '', metadata: undefined } : entry
        const persisted = this.persistLogEntry(issueId, executionId, dbEntry)
        if (persisted) {
          if (isToolUse && persisted.messageId) {
            const detail = this.buildToolDetail(entry)
            if (detail) persisted.toolDetail = detail
            // Restore content/metadata on the in-memory entry for emitting to live clients
            persisted.content = entry.content
            persisted.metadata = entry.metadata
            const toolRecordId = this.persistToolDetail(persisted.messageId, issueId, entry)
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

        if (this.isTurnCompletionEntry(entry)) {
          this.handleTurnCompleted(issueId, executionId)
        }
      }
    } catch (error) {
      const managed = this.processes.get(executionId)
      if (managed) {
        const turnIdx = this.turnIndexes.get(executionId) ?? 0
        const errorEntry: NormalizedLogEntry = {
          entryType: 'error-message',
          content: error instanceof Error ? error.message : 'Stream read error',
          turnIndex: turnIdx,
          timestamp: new Date().toISOString(),
        }
        managed.logs.push(errorEntry)
        const persisted = this.persistLogEntry(issueId, executionId, errorEntry)
        if (persisted) {
          this.emitLog(issueId, executionId, persisted)
        }
      }
    }
  }

  private isTurnCompletionEntry(entry: NormalizedLogEntry): boolean {
    if (entry.metadata?.turnCompleted === true) return true
    if (entry.metadata && Object.prototype.hasOwnProperty.call(entry.metadata, 'resultSubtype')) {
      return true
    }
    return (
      entry.entryType === 'system-message' &&
      !!entry.metadata &&
      Object.prototype.hasOwnProperty.call(entry.metadata, 'duration')
    )
  }

  private isCancelledNoiseEntry(entry: NormalizedLogEntry): boolean {
    const subtype = entry.metadata?.resultSubtype
    if (typeof subtype !== 'string' || subtype !== 'error_during_execution') return false
    const raw = `${entry.content ?? ''} ${String(entry.metadata?.error ?? '')}`.toLowerCase()
    return (
      raw.includes('request was aborted') ||
      raw.includes('request interrupted by user') ||
      raw.includes('rust analyzer lsp crashed') ||
      raw.includes('rust-analyzer-lsp')
    )
  }

  private handleTurnCompleted(issueId: string, executionId: string): void {
    const managed = this.processes.get(executionId)
    if (!managed || managed.state !== 'running') return
    managed.turnInFlight = false
    managed.queueCancelRequested = false
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
    this.sendInputToRunningProcess(issueId, managed, next.prompt)
  }

  private async consumeStderr(
    executionId: string,
    issueId: string,
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> {
    try {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const managed = this.processes.get(executionId)
          if (!managed) {
            reader.releaseLock()
            return
          }
          const turnIdx = this.turnIndexes.get(executionId) ?? 0

          const entry: NormalizedLogEntry = {
            entryType: 'error-message',
            content: line,
            turnIndex: turnIdx,
            timestamp: new Date().toISOString(),
          }
          if (managed.logs.length < MAX_LOG_ENTRIES) {
            managed.logs.push(entry)
          }
          const persisted = this.persistLogEntry(issueId, executionId, entry)
          if (persisted) {
            this.emitLog(issueId, executionId, persisted)
          }
        }
      }

      if (buffer.trim()) {
        const managed = this.processes.get(executionId)
        if (managed) {
          const turnIdx = this.turnIndexes.get(executionId) ?? 0
          const entry: NormalizedLogEntry = {
            entryType: 'error-message',
            content: buffer,
            turnIndex: turnIdx,
            timestamp: new Date().toISOString(),
          }
          if (managed.logs.length < MAX_LOG_ENTRIES) {
            managed.logs.push(entry)
          }
          const persisted = this.persistLogEntry(issueId, executionId, entry)
          if (persisted) {
            this.emitLog(issueId, executionId, persisted)
          }
        }
      }
    } catch {
      // Stderr stream closed or error — ignore
    }
  }

  // ---- Private: completion monitoring ----

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

        if (managed.cancelledByUser) {
          await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
          await autoMoveToReview(issueId)
          this.scheduleAutoCleanup(executionId)
          this.emitIssueSettled(issueId, executionId, 'cancelled')
          return
        }

        if (managed.state === 'cancelled') {
          await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
          await autoMoveToReview(issueId)
          this.scheduleAutoCleanup(executionId)
          this.emitIssueSettled(issueId, executionId, 'cancelled')
          return
        }

        const logicalFailure = managed.logicalFailure
        if (exitCode === 0 && !logicalFailure) {
          managed.state = 'completed'
          this.emitStateChange(issueId, executionId, 'completed')
          await updateIssueSession(issueId, { sessionStatus: 'completed' })
          await autoMoveToReview(issueId)
          this.scheduleAutoCleanup(executionId)
          this.emitIssueSettled(issueId, executionId, 'completed')
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
              await updateIssueSession(issueId, { sessionStatus: 'failed' })
              await autoMoveToReview(issueId)
              this.emitIssueSettled(issueId, executionId, 'failed')
            }
          } else {
            await updateIssueSession(issueId, { sessionStatus: 'failed' })
            await autoMoveToReview(issueId)
            this.scheduleAutoCleanup(executionId)
            this.emitIssueSettled(issueId, executionId, 'failed')
          }
        }
      } catch {
        managed.state = 'failed'
        managed.finishedAt = new Date()
        this.emitStateChange(issueId, executionId, 'failed')
        await updateIssueSession(issueId, { sessionStatus: 'failed' })
        await autoMoveToReview(issueId)
        this.scheduleAutoCleanup(executionId)
        this.emitIssueSettled(issueId, executionId, 'failed')
      }
    })()
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

    let spawned: SpawnedProcess

    if (issue.sessionFields.externalSessionId) {
      try {
        spawned = await executor.spawnFollowUp(
          {
            workingDir,
            prompt: issue.sessionFields.prompt ?? '',
            sessionId: issue.sessionFields.externalSessionId,
            model: issue.sessionFields.model ?? undefined,
            permissionMode: permOptions.permissionMode as any,
          },
          {
            vars: {},
            workingDir,
            projectId: issue.projectId,
            issueId,
          },
        )
      } catch (error) {
        if (!isMissingExternalSessionError(error)) throw error
        const externalSessionId = crypto.randomUUID()
        logger.warn(
          {
            issueId,
            oldExternalSessionId: issue.sessionFields.externalSessionId,
            newExternalSessionId: externalSessionId,
          },
          'issue_retry_missing_external_session_recreate',
        )
        spawned = await executor.spawn(
          {
            workingDir,
            prompt: issue.sessionFields.prompt ?? '',
            model: issue.sessionFields.model ?? undefined,
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
        await updateIssueSession(issueId, {
          externalSessionId: spawned.externalSessionId ?? externalSessionId,
        })
      }
    } else {
      const externalSessionId = crypto.randomUUID()
      spawned = await executor.spawn(
        {
          workingDir,
          prompt: issue.sessionFields.prompt ?? '',
          model: issue.sessionFields.model ?? undefined,
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
      await updateIssueSession(issueId, {
        externalSessionId: spawned.externalSessionId ?? externalSessionId,
      })
    }

    const turnIndex = this.getNextTurnIndex(issueId)
    this.register(executionId, issueId, spawned, (line) => executor.normalizeLog(line), turnIndex)
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

    let spawned: SpawnedProcess
    try {
      spawned = await executor.spawnFollowUp(
        {
          workingDir,
          prompt,
          sessionId: issue.sessionFields.externalSessionId,
          model: effectiveModel,
          permissionMode: permOptions.permissionMode as any,
        },
        {
          vars: {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
    } catch (error) {
      if (!isMissingExternalSessionError(error)) throw error
      const externalSessionId = crypto.randomUUID()
      logger.warn(
        {
          issueId,
          oldExternalSessionId: issue.sessionFields.externalSessionId,
          newExternalSessionId: externalSessionId,
          model: effectiveModel,
        },
        'issue_followup_missing_external_session_recreate',
      )
      spawned = await executor.spawn(
        {
          workingDir,
          prompt,
          model: effectiveModel,
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
      await updateIssueSession(issueId, {
        externalSessionId: spawned.externalSessionId ?? externalSessionId,
      })
    }

    const turnIndex = this.getNextTurnIndex(issueId)
    this.register(
      executionId,
      issueId,
      spawned,
      (line) => executor.normalizeLog(line),
      turnIndex,
      worktreePath,
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
      if (
        managed.state === 'running' ||
        managed.state === 'spawning' ||
        (managed.state === 'cancelled' && !managed.finishedAt)
      ) {
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
    if (isFrontendSuppressedEntry(entry)) return
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
