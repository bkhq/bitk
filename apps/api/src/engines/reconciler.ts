import { and, eq, inArray } from 'drizzle-orm'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { ensureDefaultFilterRules } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import { issueEngine } from './issue'

// ---------- Constants ----------

const RECONCILE_INTERVAL_MS = 60 * 1000 // 1 minute

// ---------- Core reconciliation logic ----------

/**
 * Scan for issues with statusId='working' that have no active engine
 * process. Move them to 'review' and update sessionStatus to a terminal
 * state. This covers:
 *   - Server restart (processes lost)
 *   - Process crash without proper settle
 *   - Any race that leaves statusId stuck at working
 */
export async function reconcileStaleWorkingIssues(): Promise<number> {
  const staleIssues = await db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      sessionStatus: issuesTable.sessionStatus,
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.statusId, 'working'), eq(issuesTable.isDeleted, 0)))

  if (staleIssues.length === 0) return 0

  let reconciled = 0

  for (const issue of staleIssues) {
    // Skip issues that genuinely have an active engine process
    if (hasActiveProcess(issue.id)) {
      continue
    }

    // No active process — this issue is stale. Determine the right sessionStatus.
    const sessionStatus = issue.sessionStatus
    const isTerminal =
      sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'cancelled'

    // If sessionStatus is still running/pending, mark it as failed
    // (the process vanished without proper settlement)
    if (!isTerminal) {
      await db
        .update(issuesTable)
        .set({ sessionStatus: 'failed', statusId: 'review' })
        .where(eq(issuesTable.id, issue.id))
    } else {
      // sessionStatus is already terminal but statusId is still working
      await db.update(issuesTable).set({ statusId: 'review' }).where(eq(issuesTable.id, issue.id))
    }

    await cacheDel(`issue:${issue.projectId}:${issue.id}`)
    emitIssueUpdated(issue.id, { statusId: 'review' })
    logger.info(
      { issueId: issue.id, previousSessionStatus: sessionStatus },
      'reconciler_moved_to_review',
    )
    reconciled++
  }

  return reconciled
}

// ---------- Active process check ----------

/**
 * Check whether the IssueEngine has an active (running/spawning) process
 * for the given issue.
 */
function hasActiveProcess(issueId: string): boolean {
  return issueEngine.hasActiveProcessForIssue(issueId)
}

// ---------- Startup reconciliation ----------

/**
 * Run reconciliation at server startup. Also fixes sessionStatus for issues
 * whose sessions were running/pending when the server last stopped.
 */
export async function startupReconciliation(): Promise<void> {
  // Seed default write-filter rules if not present
  await ensureDefaultFilterRules()

  // First, mark stale sessions (running/pending sessionStatus) as failed.
  // This was previously done by cleanupStaleSessions in db/helpers.
  const staleStatuses = ['running', 'pending']
  const staleRows = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(inArray(issuesTable.sessionStatus, staleStatuses), eq(issuesTable.isDeleted, 0)))

  if (staleRows.length > 0) {
    const ids = staleRows.map((r) => r.id)
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'failed' })
      .where(inArray(issuesTable.id, ids))
    logger.info({ count: staleRows.length }, 'reconciler_marked_stale_sessions_failed')
  }

  // Now reconcile: any issue that is working with no active process
  // should move to review.
  const reconciled = await reconcileStaleWorkingIssues()
  if (reconciled > 0) {
    logger.info({ count: reconciled }, 'reconciler_startup_moved_to_review')
  }
}

// ---------- Periodic reconciliation ----------

let reconcileTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start a periodic reconciliation timer. Safe to call multiple times
 * (subsequent calls are no-ops).
 */
export function startPeriodicReconciliation(): void {
  if (reconcileTimer) return

  reconcileTimer = setInterval(() => {
    void reconcileStaleWorkingIssues()
      .then((count) => {
        if (count > 0) {
          logger.info({ count }, 'reconciler_periodic_moved_to_review')
        }
      })
      .catch((err) => {
        logger.error({ err }, 'reconciler_periodic_failed')
      })
  }, RECONCILE_INTERVAL_MS)

  // Allow the process to exit without waiting for this timer
  if (reconcileTimer && typeof reconcileTimer === 'object' && 'unref' in reconcileTimer) {
    reconcileTimer.unref()
  }
}

/**
 * Stop the periodic reconciliation timer.
 */
export function stopPeriodicReconciliation(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer)
    reconcileTimer = null
  }
}

// ---------- Triggered reconciliation ----------

/**
 * Register a callback on the IssueEngine's issueSettled event to run
 * reconciliation after every process completion/failure. This catches
 * edge cases where the DB update in monitorCompletion succeeds for
 * sessionStatus but the statusId update was missed.
 */
export function registerSettledReconciliation(): void {
  issueEngine.onIssueSettled((_issueId, _executionId, _state) => {
    // Run reconciliation after a short delay to allow the engine's own
    // autoMoveToReview to complete first. If it succeeded, the reconciler
    // will simply find zero stale issues.
    setTimeout(() => {
      void reconcileStaleWorkingIssues().catch((err) => {
        logger.error({ err }, 'reconciler_settled_trigger_failed')
      })
    }, 1000)
  })
}
