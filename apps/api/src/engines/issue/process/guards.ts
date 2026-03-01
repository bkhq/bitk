import type { EngineContext } from '@/engines/issue/context'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'
import { getActiveProcessForIssue } from './state'

// ---------- Guards ----------

export function ensureNoActiveProcess(
  ctx: EngineContext,
  issueId: string,
): void {
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
