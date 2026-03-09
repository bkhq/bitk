import { ProcessManager } from '@/engines/process-manager'
import type { EngineType, PermissionPolicy } from '@/engines/types'
import { logger } from '@/logger'
import { AUTO_CLEANUP_DELAY_MS, GC_INTERVAL_MS, MAX_CONCURRENT_EXECUTIONS } from './constants'
import type { EngineContext } from './context'
import { gcSweep } from './gc'
import {
  cancelIssue,
  executeIssue,
  followUpIssue,
  restartIssue,
  restartStaleSessions,
} from './orchestration'
import type { PaginatedLogResult } from './persistence/queries'
import { registerLogPipeline } from './pipeline'
import { terminateProcess } from './process/cancel'
import {
  cancelAll,
  getActiveProcessesList,
  getCategorizedCommands,
  getLogs,
  getProcess,
  getSlashCommands,
  hasActiveProcessForIssue,
  isTurnInFlight,
} from './queries'
import type { ManagedProcess } from './types'

// ---------- IssueEngine ----------

export class IssueEngine {
  private ctx: EngineContext
  private gcTimer: ReturnType<typeof setInterval>

  constructor() {
    const pm = new ProcessManager<ManagedProcess>('issue', {
      maxConcurrent: MAX_CONCURRENT_EXECUTIONS,
      autoCleanupDelayMs: AUTO_CLEANUP_DELAY_MS,
      gcIntervalMs: 0, // IssueEngine keeps its own domain GC
      killTimeoutMs: 30_000,
      logger,
      onRemove: (_id, meta) => meta.logs.destroy(),
    })

    this.ctx = {
      pm,
      issueOpLocks: new Map(),
      entryCounters: new Map(),
      turnIndexes: new Map(),
      userMessageIds: new Map(),
      lastErrors: new Map(),
      lockDepth: new Map(),
      // Placeholder — injected below after ctx is created
      followUpIssue: null,
    }

    // Register the unified log pipeline on the global event bus
    registerLogPipeline(this.ctx)

    // Inject followUpIssue to break lifecycle → orchestration cycle
    this.ctx.followUpIssue = (
      issueId: string,
      prompt: string,
      model?: string,
      permissionMode?: PermissionPolicy,
      busyAction?: 'queue' | 'cancel',
      displayPrompt?: string,
      metadata?: Record<string, unknown>,
      opts?: { skipPersistMessage?: boolean },
    ) =>
      followUpIssue(
        this.ctx,
        issueId,
        prompt,
        model,
        permissionMode,
        busyAction,
        displayPrompt,
        metadata,
        opts,
      )

    this.gcTimer = setInterval(() => {
      try {
        gcSweep(this.ctx)
      } catch (err) {
        logger.error({ err }, 'gc_sweep_failed')
      }
    }, GC_INTERVAL_MS)
    if (this.gcTimer && typeof this.gcTimer === 'object' && 'unref' in this.gcTimer) {
      this.gcTimer.unref()
    }

    // ExecutionStore lifecycle: destroyed via onRemove callback in PM options
    // when the process entry is auto-cleaned (after AUTO_CLEANUP_DELAY_MS).
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
      envVars?: Record<string, string>
    },
  ): Promise<{ executionId: string; messageId?: string | null }> {
    return executeIssue(this.ctx, issueId, opts)
  }

  async followUpIssue(
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionPolicy,
    busyAction: 'queue' | 'cancel' = 'queue',
    displayPrompt?: string,
    metadata?: Record<string, unknown>,
    opts?: { skipPersistMessage?: boolean },
  ): Promise<{ executionId: string; messageId?: string | null }> {
    return followUpIssue(
      this.ctx,
      issueId,
      prompt,
      model,
      permissionMode,
      busyAction,
      displayPrompt,
      metadata,
      opts,
    )
  }

  async restartIssue(issueId: string): Promise<{ executionId: string }> {
    return restartIssue(this.ctx, issueId)
  }

  async cancelIssue(issueId: string): Promise<'interrupted' | 'cancelled'> {
    return cancelIssue(this.ctx, issueId)
  }

  async restartStaleSessions(): Promise<number> {
    return restartStaleSessions()
  }

  // ---- Process queries ----

  getLogs(
    issueId: string,
    devMode = false,
    opts?: {
      cursor?: string // ULID id — fetch entries after this
      before?: string // ULID id — fetch entries before this
      limit?: number
    },
  ): PaginatedLogResult {
    return getLogs(this.ctx, issueId, devMode, opts)
  }

  getProcess(executionId: string): ManagedProcess | undefined {
    return getProcess(this.ctx, executionId)
  }

  hasActiveProcessForIssue(issueId: string): boolean {
    return hasActiveProcessForIssue(this.ctx, issueId)
  }

  isTurnInFlight(issueId: string): boolean {
    return isTurnInFlight(this.ctx, issueId)
  }

  getSlashCommands(issueId: string, engineType?: EngineType): string[] {
    return getSlashCommands(this.ctx, issueId, engineType)
  }

  getCategorizedCommands(
    issueId: string,
    engineType?: EngineType,
  ): import('@bkd/shared').CategorizedCommands {
    return getCategorizedCommands(this.ctx, issueId, engineType)
  }

  getActiveProcesses(): ManagedProcess[] {
    return getActiveProcessesList(this.ctx)
  }

  async cancelAll(): Promise<void> {
    return cancelAll(this.ctx)
  }

  async terminateProcess(issueId: string): Promise<void> {
    return terminateProcess(this.ctx, issueId)
  }

  // ---- Concurrency config ----

  setMaxConcurrent(n: number): void {
    this.ctx.pm.setMaxConcurrent(n)
  }

  async initMaxConcurrent(): Promise<void> {
    const { getAppSetting } = await import('@/db/helpers')
    const value = await getAppSetting('engine:maxConcurrentExecutions')
    if (value) {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 1) {
        this.ctx.pm.setMaxConcurrent(n)
      }
    }
  }

  // ---- Error tracking ----

  getLastError(issueId: string): string | undefined {
    return this.ctx.lastErrors.get(issueId)
  }

  setLastError(issueId: string, message: string): void {
    this.ctx.lastErrors.set(issueId, message)
  }
}

// Singleton
export const issueEngine = new IssueEngine()
