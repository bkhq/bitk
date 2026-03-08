import type { AppEventMap } from '@bkd/shared'
import type { EngineContext } from '../context'

/**
 * Order 20 — ExecutionStore push.
 *
 * Pushes non-streaming entries into the in-memory ExecutionStore
 * so `getLogs()` can merge DB + recent entries for fast reads.
 *
 * (Formerly used RingBuffer; now uses ExecutionStore which provides
 * the same push/toArray/length interface plus structured queries.)
 */
export function registerRingBufferStage(
  ctx: EngineContext,
  on: (
    cb: (data: AppEventMap['log']) => void,
    opts: { order: number },
  ) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return
      const managed = ctx.pm.get(data.executionId)?.meta
      if (managed) managed.logs.push(data.entry)
    },
    { order: 20 },
  )
}
