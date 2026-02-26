import type {
  EngineType,
  NormalizedLogEntry,
  PermissionPolicy,
  ProcessStatus,
  SpawnedProcess,
} from './types'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { asc, eq, max } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '../db'
import { issueLogs as logsTable, projects as projectsTable } from '../db/schema'
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
  dangerouslySkipPermissions: boolean
} {
  const profile = BUILT_IN_PROFILES[engineType]
  const policy = overridePolicy ?? profile?.permissionPolicy ?? 'supervised'

  if (policy === 'bypass') {
    return { permissionMode: 'bypass', dangerouslySkipPermissions: true }
  }

  return { permissionMode: policy, dangerouslySkipPermissions: false }
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
  logger.info({ issueId, worktreeDir, branchName }, 'worktree_created')
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
    logger.info({ worktreeDir }, 'worktree_removed')
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
  ): Promise<{ executionId: string }> {
    return this.withIssueLock(issueId, async () => {
      logger.info(
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
          dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
          externalSessionId,
        },
        {
          vars: {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )

      await updateIssueSession(issueId, { externalSessionId })
      logger.info(
        {
          issueId,
          executionId,
          pid: this.getPidFromSubprocess(spawned.subprocess),
          engineType: opts.engineType,
          externalSessionId,
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
      this.persistUserMessage(issueId, executionId, opts.prompt)
      this.monitorCompletion(executionId, issueId, opts.engineType, false)

      return { executionId }
    })
  }

  async followUpIssue(
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionPolicy,
    busyAction: 'queue' | 'cancel' = 'queue',
  ): Promise<{ executionId: string }> {
    return this.withIssueLock(issueId, async () => {
      logger.info(
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
          logger.info(
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
            logger.info(
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
          return { executionId: active.executionId }
        }

        // Engine is idle: send immediately on existing process.
        // If this races with process exit, fall back to spawning a follow-up process.
        try {
          this.sendInputToRunningProcess(issueId, active, prompt)
          return { executionId: active.executionId }
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
          return this.spawnFollowUpProcess(issueId, prompt, effectiveModel, permissionMode)
        }
      }

      logger.info(
        { issueId, engineType, model: effectiveModel },
        'issue_followup_spawn_new_process',
      )
      return this.spawnFollowUpProcess(issueId, prompt, effectiveModel, permissionMode)
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
            dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
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
            dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
            externalSessionId,
          },
          {
            vars: {},
            workingDir,
            projectId: issue.projectId,
            issueId,
          },
        )
        await updateIssueSession(issueId, { externalSessionId })
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
        logger.info(
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
    logParser: (line: string) => NormalizedLogEntry | null,
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
    logger.info(
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

    logger.info(
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
      logger.info(
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
      logger.info(
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

  private persistLogEntry(issueId: string, executionId: string, entry: NormalizedLogEntry): void {
    try {
      const messageId = entry.messageId ?? ulid()
      entry.messageId = messageId
      const idx = this.entryCounters.get(executionId) ?? 0
      this.entryCounters.set(executionId, idx + 1)
      const turnIdx = this.turnIndexes.get(executionId) ?? 0

      // For non-user-message entries, link back to the user message that started this turn
      let replyToMessageId: string | null = null
      if (entry.entryType !== 'user-message') {
        const replyTo = this.userMessageIds.get(`${issueId}:${turnIdx}`)
        if (replyTo) {
          replyToMessageId = replyTo
          entry.replyToMessageId = replyTo
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
          toolAction: entry.toolAction ? JSON.stringify(entry.toolAction) : null,
          replyToMessageId,
          timestamp: entry.timestamp ?? null,
        })
        .run()
    } catch (error) {
      logger.warn({ err: error, issueId }, 'persistLogEntry failed')
    }
  }

  private getLogsFromDb(issueId: string): NormalizedLogEntry[] {
    const rows = db
      .select()
      .from(logsTable)
      .where(eq(logsTable.issueId, issueId))
      .orderBy(asc(logsTable.turnIndex), asc(logsTable.entryIndex))
      .all()

    return rows.map((row) => ({
      messageId: row.id,
      replyToMessageId: row.replyToMessageId ?? undefined,
      entryType: row.entryType as NormalizedLogEntry['entryType'],
      content: row.content.trim(),
      turnIndex: row.turnIndex,
      timestamp: row.timestamp ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      toolAction: row.toolAction ? JSON.parse(row.toolAction) : undefined,
    }))
  }

  private getNextTurnIndex(issueId: string): number {
    const [row] = db
      .select({ maxTurn: max(logsTable.turnIndex) })
      .from(logsTable)
      .where(eq(logsTable.issueId, issueId))
      .all()
    return (row?.maxTurn ?? -1) + 1
  }

  private persistUserMessage(issueId: string, executionId: string, prompt: string): void {
    const turnIdx = this.turnIndexes.get(executionId) ?? 0
    const entry: NormalizedLogEntry = {
      entryType: 'user-message',
      content: prompt.trim(),
      turnIndex: turnIdx,
      timestamp: new Date().toISOString(),
    }

    // Push to in-memory logs
    const managed = this.processes.get(executionId)
    if (managed) {
      managed.logs.push(entry)
    }

    // Persist and emit
    this.persistLogEntry(issueId, executionId, entry)
    this.emitLog(issueId, executionId, entry)

    // Store user message ID so agent responses in this turn can reference it
    if (entry.messageId) {
      this.userMessageIds.set(`${issueId}:${turnIdx}`, entry.messageId)
    }
  }

  private sendInputToRunningProcess(
    issueId: string,
    managed: ManagedProcess,
    prompt: string,
  ): void {
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
    this.persistUserMessage(issueId, managed.executionId, prompt)
    logger.info(
      {
        issueId,
        executionId: managed.executionId,
        pid: this.getPidFromManaged(managed),
        promptChars: prompt.length,
      },
      'issue_process_input_sent',
    )
    this.emitStateChange(issueId, managed.executionId, 'running')
  }

  // ---- Private: stream consumers ----

  private async consumeStream(
    executionId: string,
    issueId: string,
    stream: ReadableStream<Uint8Array>,
    parser: (line: string) => NormalizedLogEntry | null,
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
        if (managed.logs.length < MAX_LOG_ENTRIES) {
          managed.logs.push(entry)
        }

        this.persistLogEntry(issueId, executionId, entry)
        this.emitLog(issueId, executionId, entry)

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
        this.persistLogEntry(issueId, executionId, errorEntry)
        this.emitLog(issueId, executionId, errorEntry)
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
    // mark session completed and auto-move to review.
    const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
    managed.state = finalStatus as ProcessStatus
    this.emitStateChange(issueId, executionId, finalStatus as ProcessStatus)

    void (async () => {
      try {
        await updateIssueSession(issueId, { sessionStatus: finalStatus })
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
    logger.info(
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
          this.persistLogEntry(issueId, executionId, entry)
          this.emitLog(issueId, executionId, entry)
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
          this.persistLogEntry(issueId, executionId, entry)
          this.emitLog(issueId, executionId, entry)
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
        if (managed.state === 'completed' || managed.state === 'failed') {
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
              logger.info(
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
    logger.info({ issueId, engineType }, 'issue_retry_requested')
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
            dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
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
            dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
            externalSessionId,
          },
          {
            vars: {},
            workingDir,
            projectId: issue.projectId,
            issueId,
          },
        )
        await updateIssueSession(issueId, { externalSessionId })
      }
    } else {
      const externalSessionId = crypto.randomUUID()
      spawned = await executor.spawn(
        {
          workingDir,
          prompt: issue.sessionFields.prompt ?? '',
          model: issue.sessionFields.model ?? undefined,
          permissionMode: permOptions.permissionMode as any,
          dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
          externalSessionId,
        },
        {
          vars: {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
      await updateIssueSession(issueId, { externalSessionId })
    }

    const turnIndex = this.getNextTurnIndex(issueId)
    this.register(executionId, issueId, spawned, (line) => executor.normalizeLog(line), turnIndex)
    this.monitorCompletion(executionId, issueId, engineType, true)
    logger.info({ issueId, executionId, engineType, turnIndex }, 'issue_retry_spawned')
  }

  private async spawnFollowUpProcess(
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionPolicy,
  ): Promise<{ executionId: string }> {
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
          dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
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
          dangerouslySkipPermissions: permOptions.dangerouslySkipPermissions,
          externalSessionId,
        },
        {
          vars: {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
      await updateIssueSession(issueId, { externalSessionId })
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
    this.persistUserMessage(issueId, executionId, prompt)
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

    return { executionId }
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
      const issueId = key.split(':')[0]
      if (!activeIssueIds.has(issueId)) {
        this.userMessageIds.delete(key)
        cleaned++
      }
    }
    if (cleaned > 0) {
      logger.info(
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
