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
    const depth = (ctx as any).__lockDepth?.get(issueId) ?? 0
    if (depth >= MAX_QUEUE_DEPTH) {
      throw new Error(
        `Lock queue full for issue ${issueId} (max ${MAX_QUEUE_DEPTH})`,
      )
    }
  }

  // Track queue depth
  if (!(ctx as any).__lockDepth) {
    ;(ctx as any).__lockDepth = new Map<string, number>()
  }
  const depthMap = (ctx as any).__lockDepth as Map<string, number>
  depthMap.set(issueId, (depthMap.get(issueId) ?? 0) + 1)

  const tail = currentTail ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const newTail = tail.then(() => gate)
  ctx.issueOpLocks.set(issueId, newTail)

  // Acquire lock with timeout
  const acquireStart = Date.now()
  const acquired = await Promise.race([
    tail.then(() => true as const),
    new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), LOCK_ACQUIRE_TIMEOUT_MS),
    ),
  ])

  if (acquired === 'timeout') {
    release()
    depthMap.set(issueId, (depthMap.get(issueId) ?? 1) - 1)
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

  try {
    // Execute with timeout
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Lock execution timeout for issue ${issueId} after ${LOCK_EXECUTION_TIMEOUT_MS}ms`,
              ),
            ),
          LOCK_EXECUTION_TIMEOUT_MS,
        ),
      ),
    ])
    return result
  } finally {
    release()
    depthMap.set(issueId, (depthMap.get(issueId) ?? 1) - 1)
    if ((depthMap.get(issueId) ?? 0) <= 0) {
      depthMap.delete(issueId)
    }
    if (ctx.issueOpLocks.get(issueId) === newTail) {
      ctx.issueOpLocks.delete(issueId)
    }
  }
}
