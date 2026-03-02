import type { EngineContext } from '@/engines/issue/context'
import { logger } from '@/logger'

// ---------- Per-issue mutex ----------

const LOCK_ACQUIRE_TIMEOUT_MS = 30_000
const LOCK_EXECUTION_TIMEOUT_MS = 120_000
const MAX_QUEUE_DEPTH = 10

export async function withIssueLock<T>(
  ctx: EngineContext,
  issueId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Count current queue depth for this issue
  const currentTail = ctx.issueOpLocks.get(issueId)
  if (currentTail) {
    const depth = ctx.lockDepth.get(issueId) ?? 0
    if (depth >= MAX_QUEUE_DEPTH) {
      throw new Error(
        `Lock queue full for issue ${issueId} (max ${MAX_QUEUE_DEPTH})`,
      )
    }
  }

  // Track queue depth
  ctx.lockDepth.set(issueId, (ctx.lockDepth.get(issueId) ?? 0) + 1)

  const tail = currentTail ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const newTail = tail.then(() => gate)
  ctx.issueOpLocks.set(issueId, newTail)

  // Acquire lock with timeout
  const acquireStart = Date.now()
  let acquireTimer: ReturnType<typeof setTimeout> | undefined
  const acquired = await Promise.race([
    tail.then(() => true as const),
    new Promise<'timeout'>((resolve) => {
      acquireTimer = setTimeout(
        () => resolve('timeout'),
        LOCK_ACQUIRE_TIMEOUT_MS,
      )
    }),
  ])
  if (acquireTimer !== undefined) clearTimeout(acquireTimer)

  if (acquired === 'timeout') {
    release()
    ctx.lockDepth.set(issueId, (ctx.lockDepth.get(issueId) ?? 1) - 1)
    if (ctx.issueOpLocks.get(issueId) === newTail) {
      ctx.issueOpLocks.delete(issueId)
    }
    throw new Error(
      `Lock acquire timeout for issue ${issueId} after ${LOCK_ACQUIRE_TIMEOUT_MS}ms`,
    )
  }

  const waitMs = Date.now() - acquireStart
  if (waitMs > 10_000) {
    logger.warn({ issueId, waitMs }, 'issue_lock_slow_acquire')
  }

  let execTimer: ReturnType<typeof setTimeout> | undefined
  try {
    // Execute with timeout
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        execTimer = setTimeout(
          () =>
            reject(
              new Error(
                `Lock execution timeout for issue ${issueId} after ${LOCK_EXECUTION_TIMEOUT_MS}ms`,
              ),
            ),
          LOCK_EXECUTION_TIMEOUT_MS,
        )
      }),
    ])
    return result
  } finally {
    if (execTimer !== undefined) clearTimeout(execTimer)
    release()
    ctx.lockDepth.set(issueId, (ctx.lockDepth.get(issueId) ?? 1) - 1)
    if ((ctx.lockDepth.get(issueId) ?? 0) <= 0) {
      ctx.lockDepth.delete(issueId)
    }
    if (ctx.issueOpLocks.get(issueId) === newTail) {
      ctx.issueOpLocks.delete(issueId)
    }
  }
}
