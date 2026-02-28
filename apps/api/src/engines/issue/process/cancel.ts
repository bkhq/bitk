import type { EngineContext } from '@/engines/issue/context'
import { emitStateChange } from '@/engines/issue/events'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'

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
