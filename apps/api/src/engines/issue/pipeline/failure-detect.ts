import type { AppEventMap } from '@bkd/shared'
import type { EngineContext } from '../context'
import { dispatch } from '../state'

/**
 * Order 40 — Logical failure detection.
 *
 * Inspects non-streaming entries for error signals (resultSubtype,
 * isError metadata) and dispatches SET_LOGICAL_FAILURE so that
 * monitorCompletion can mark the run as failed even when exit code is 0.
 */
export function registerFailureDetectStage(
  ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return
      const managed = ctx.pm.get(data.executionId)?.meta
      if (!managed || managed.lastInterruptAt) return
      const { entry } = data
      const resultSubtype = entry.metadata?.resultSubtype
      const isResultError = typeof resultSubtype === 'string' && resultSubtype !== 'success'
      if (isResultError || entry.metadata?.isError === true) {
        dispatch(managed, {
          type: 'SET_LOGICAL_FAILURE',
          reason:
            (entry.metadata?.error as string | undefined) ?? String(resultSubtype ?? 'unknown'),
        })
      }
    },
    { order: 40 },
  )
}
