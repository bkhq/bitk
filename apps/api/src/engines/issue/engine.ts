import { ProcessManager } from '@/engines/process-manager'
import type {
  EngineType,
  NormalizedLogEntry,
  PermissionPolicy,
} from '@/engines/types'
import { logger } from '@/logger'
import {
  AUTO_CLEANUP_DELAY_MS,
  GC_INTERVAL_MS,
  MAX_CONCURRENT_EXECUTIONS,
} from './constants'
import type { EngineContext } from './context'
import { gcSweep } from './gc'
import {
  cancelIssue,
  executeIssue,
  followUpIssue,
  restartIssue,
  restartStaleSessions,
} from './orchestration'
import { registerLogPipeline } from './pipeline'
import { terminateProcess } from './process/cancel'
import {
  cancelAll,
  getActiveProcessesList,
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

    this.gcTimer = setInterval(() => gcSweep(this.ctx), GC_INTERVAL_MS)
    if (
      this.gcTimer &&
      typeof this.gcTimer === 'object' &&
      'unref' in this.gcTimer
    ) {
      this.gcTimer.unref()
    }

    // Sync PM auto-cleanup with domain data
    pm.onStateChange((entry) => {
      const state = entry.state
      if (
        state === 'completed' ||
        state === 'failed' ||
        state === 'cancelled'
      ) {
        // When PM auto-removes, clean domain data too
        // (entryCounters, turnIndexes are cleaned on remove)
      }
    })
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
  ): NormalizedLogEntry[] {
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

  getActiveProcesses(): ManagedProcess[] {
    return getActiveProcessesList(this.ctx)
  }

  async cancelAll(): Promise<void> {
    return cancelAll(this.ctx)
  }

  async terminateProcess(issueId: string): Promise<void> {
    return terminateProcess(this.ctx, issueId)
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
