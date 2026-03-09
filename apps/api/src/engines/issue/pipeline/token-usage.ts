import type { AppEventMap } from '@bkd/shared'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { issues } from '@/db/schema'
import { logger } from '@/logger'
import type { EngineContext } from '../context'

/**
 * Order 15 — Token usage accumulation.
 *
 * Detects result entries (turnCompleted) that carry token/cost metadata
 * and atomically increments the issue's running totals in the DB.
 */
export function registerTokenUsageStage(
  _ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return

      const meta = data.entry.metadata
      if (!meta) return

      // Only process result entries that signal turn completion
      if (!meta.turnCompleted) return

      const inputTokens = typeof meta.inputTokens === 'number' ? meta.inputTokens : 0
      const outputTokens = typeof meta.outputTokens === 'number' ? meta.outputTokens : 0
      const costUsd = typeof meta.costUsd === 'number' ? meta.costUsd : 0

      if (inputTokens === 0 && outputTokens === 0 && costUsd === 0) return

      try {
        db.update(issues)
          .set({
            totalInputTokens: sql`${issues.totalInputTokens} + ${inputTokens}`,
            totalOutputTokens: sql`${issues.totalOutputTokens} + ${outputTokens}`,
            totalCostUsd: sql`CAST(CAST(${issues.totalCostUsd} AS REAL) + ${costUsd} AS TEXT)`,
          })
          .where(sql`${issues.id} = ${data.issueId}`)
          .run()
      } catch (error) {
        logger.warn({ issueId: data.issueId, error }, 'token_usage_accumulate_failed')
      }
    },
    { order: 15 },
  )
}
