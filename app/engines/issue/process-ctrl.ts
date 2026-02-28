import type { ProcessStatus } from '../types'
import type { EngineContext } from './context'
import type { ManagedProcess } from './types'
import { logger } from '../../logger'
import { getPidFromManaged } from './context'
import { emitStateChange } from './events'

// ---------- Per-issue mutex ----------

export async function withIssueLock<T>(
  ctx: EngineContext,
  issueId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tail = ctx.issueOpLocks.get(issueId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const newTail = tail.then(() => gate)
  ctx.issueOpLocks.set(issueId, newTail)

  await tail
  try {
    return await fn()
  } finally {
    release()
    if (ctx.issueOpLocks.get(issueId) === newTail) {
      ctx.issueOpLocks.delete(issueId)
    }
  }
}

// ---------- Cancel ----------

export async function cancel(
  ctx: EngineContext,
  executionId: string,
  opts: { emitCancelledState?: boolean; hard?: boolean } = {},
): Promise<void> {
  const entry = ctx.pm.get(executionId)
  if (!entry) return
  const managed = entry.meta
  if (entry.state !== 'running') return

  logger.debug(
    {
      issueId: managed.issueId,
      executionId,
      pid: getPidFromManaged(managed),
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
      { issueId: managed.issueId, executionId, pid: getPidFromManaged(managed) },
      'issue_process_interrupt_sent',
    )
    return
  }

  // Hard cancel: delegate kill timeout to PM
  managed.state = 'cancelled'
  if (opts.emitCancelledState !== false) {
    emitStateChange(ctx, managed.issueId, executionId, 'cancelled')
  }

  await ctx.pm.terminate(executionId, () => managed.process.cancel())
  managed.finishedAt = entry.finishedAt ?? new Date()
  logger.debug(
    { issueId: managed.issueId, executionId, pid: getPidFromManaged(managed) },
    'issue_process_cancel_finished',
  )
}

// ---------- Guards ----------

export function ensureNoActiveProcess(ctx: EngineContext, issueId: string): void {
  if (ctx.pm.hasActiveInGroup(issueId)) {
    const active = getActiveProcessForIssue(ctx, issueId)
    throw new Error(
      `Issue ${issueId} already has an active process (${active?.executionId}). Cancel it first or wait for completion.`,
    )
  }
}

/** Kill any existing subprocess for this issue (regardless of managed state).
 *  Used as a safety guard before spawning a new follow-up process to prevent
 *  duplicate CLI processes for the same session. */
export async function killExistingSubprocessForIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<void> {
  await ctx.pm.terminateGroup(issueId, (entry) => {
    logger.debug(
      { issueId, executionId: entry.id, pid: getPidFromManaged(entry.meta) },
      'issue_killed_existing_subprocess_before_followup_spawn',
    )
    entry.meta.finishedAt = new Date()
  })
}

// ---------- Queries ----------

export function getActiveProcesses(ctx: EngineContext): ManagedProcess[] {
  return ctx.pm.getActive().map((e) => e.meta)
}

export function getActiveProcessForIssue(
  ctx: EngineContext,
  issueId: string,
): ManagedProcess | undefined {
  return ctx.pm.getFirstActiveInGroup(issueId)?.meta
}

// ---------- Domain data cleanup ----------

export function cleanupDomainData(ctx: EngineContext, executionId: string): void {
  ctx.entryCounters.delete(executionId)
  ctx.turnIndexes.delete(executionId)
}

/** Sync ProcessManager state with the domain state set by IssueEngine.
 *  PM's transitionState is idempotent, so double-sets are safe. */
export function syncPmState(ctx: EngineContext, executionId: string, state: ProcessStatus): void {
  if (state === 'completed') ctx.pm.markCompleted(executionId)
  else if (state === 'failed') ctx.pm.markFailed(executionId)
  // 'cancelled' is handled by pm.terminate() in cancel()
}
