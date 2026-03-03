import type { AppEventMap } from '@bitk/shared'
import type { EngineContext } from '../context'

/**
 * Order 20 — Ring buffer push.
 *
 * Pushes non-streaming entries into the in-memory ring buffer
 * so `getLogs()` can merge DB + recent entries for fast reads.
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
