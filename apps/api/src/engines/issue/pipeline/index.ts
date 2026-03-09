import { appEvents } from '@/events'
import type { EngineContext } from '../context'
import { registerAutoTitleStage } from './auto-title'
import { registerFailureDetectStage } from './failure-detect'
import { registerPersistStage } from './persist'
import { registerRingBufferStage } from './ring-buffer'
import { registerTokenUsageStage } from './token-usage'

/**
 * Register all log-entry pipeline stages on the global event bus.
 *
 * Each stage is an independent ordered subscriber:
 *   order 10   — DB persistence + messageId enrichment  (persist.ts)
 *   order 15   — token usage accumulation               (token-usage.ts)
 *   order 20   — ring buffer push                       (ring-buffer.ts)
 *   order 30   — auto-title extraction                  (auto-title.ts)
 *   order 40   — logical failure detection              (failure-detect.ts)
 *   order 100  — SSE broadcast (registered by routes/events.ts)
 *
 * DevMode visibility filtering is NOT a pipeline stage — it only applies
 * at the SSE boundary (order 100) so that DB persistence and failure
 * detection always process all entries regardless of devMode setting.
 *
 * Stages are isolated: a failure in one does not block subsequent stages.
 * In particular, DB persistence failure no longer prevents SSE delivery.
 */
export function registerLogPipeline(ctx: EngineContext): void {
  const on = (cb: Parameters<typeof appEvents.on<'log'>>[1], opts: { order: number }) =>
    appEvents.on('log', cb, opts)

  registerPersistStage(ctx, on)
  registerTokenUsageStage(ctx, on)
  registerRingBufferStage(ctx, on)
  registerAutoTitleStage(ctx, on)
  registerFailureDetectStage(ctx, on)
}
