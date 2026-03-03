import type { AppEventMap } from '@bitk/shared'
import type { EngineContext } from '../context'
import { applyAutoTitle } from '../title'

/**
 * Order 30 — Auto-title extraction.
 *
 * When the current turn is a meta-turn (title generation),
 * extracts the AI response and updates the issue title.
 */
export function registerAutoTitleStage(
  ctx: EngineContext,
  on: (
    cb: (data: AppEventMap['log']) => void,
    opts: { order: number },
  ) => () => void,
): () => void {
  return on(
    (data) => {
      const managed = ctx.pm.get(data.executionId)?.meta
      if (managed?.metaTurn && data.entry.entryType === 'assistant-message') {
        applyAutoTitle(data.issueId, data.entry.content)
      }
    },
    { order: 30 },
  )
}
