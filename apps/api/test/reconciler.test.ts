import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import {
  reconcileStaleWorkingIssues,
  startupReconciliation,
  stopPeriodicReconciliation,
} from '@/engines/reconciler'
/**
 * Reconciler unit tests — verifies:
 * 1. reconcileStaleWorkingIssues moves orphaned working issues to review
 * 2. reconcileStaleWorkingIssues skips issues with active processes
 * 3. startupReconciliation marks running/pending sessions as failed
 * 4. startupReconciliation then moves orphaned working issues to review
 *
 * Strategy: We directly manipulate the DB to simulate stuck/stale states,
 * then run the reconciler functions. The echo engine is not running, so
 * issueEngine.hasActiveProcessForIssue returns false for all test issues —
 * which is exactly the "orphaned" scenario we want to test.
 */
import './setup'

// ---------- Test project + helpers ----------

let projectId: string

async function createDirectIssue(overrides: {
  statusId: string
  sessionStatus?: string | null
  title?: string
}) {
  const [maxRow] = await db
    .select({ maxNum: db.$count(issuesTable) })
    .from(issuesTable)
  const num = (maxRow?.maxNum ?? 0) + 1

  const [row] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: overrides.statusId,
      issueNumber: num,
      title: overrides.title ?? `Reconciler Test Issue ${num}`,
      priority: 'medium',
      sortOrder: 0,
      engineType: 'echo',
      sessionStatus: overrides.sessionStatus ?? null,
      prompt: 'test prompt',
      model: 'auto',
    })
    .returning()

  return row!
}

async function getIssue(id: string) {
  const [row] = await db
    .select()
    .from(issuesTable)
    .where(eq(issuesTable.id, id))
  return row
}

beforeAll(async () => {
  // Create a test project directly in the DB
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Reconciler Test Project',
      alias: `reconciler-test-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

afterEach(() => {
  stopPeriodicReconciliation()
})

// ============================
// reconcileStaleWorkingIssues
// ============================

describe('reconcileStaleWorkingIssues', () => {
  test('moves working issue without active process to review', async () => {
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
    })

    // No active process exists in the engine (nothing was spawned)
    const count = await reconcileStaleWorkingIssues()
    expect(count).toBeGreaterThanOrEqual(1)

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    expect(updated!.sessionStatus).toBe('failed')
  })

  test('moves working issue with terminal sessionStatus to review (statusId only)', async () => {
    // Session completed but statusId stuck at working (race condition scenario)
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'completed',
    })

    const count = await reconcileStaleWorkingIssues()
    expect(count).toBeGreaterThanOrEqual(1)

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    // sessionStatus should remain 'completed' (it was already terminal)
    expect(updated!.sessionStatus).toBe('completed')
  })

  test('marks non-terminal sessionStatus as failed when moving to review', async () => {
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'pending',
    })

    await reconcileStaleWorkingIssues()

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    expect(updated!.sessionStatus).toBe('failed')
  })

  test('does not touch non-working issues', async () => {
    const todoIssue = await createDirectIssue({
      statusId: 'todo',
      sessionStatus: null,
    })
    const reviewIssue = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'completed',
    })
    const doneIssue = await createDirectIssue({
      statusId: 'done',
      sessionStatus: 'completed',
    })

    await reconcileStaleWorkingIssues()

    const todo = await getIssue(todoIssue.id)
    const review = await getIssue(reviewIssue.id)
    const done = await getIssue(doneIssue.id)

    expect(todo!.statusId).toBe('todo')
    expect(review!.statusId).toBe('review')
    expect(done!.statusId).toBe('done')
  })

  test('handles multiple stale working issues at once', async () => {
    const issue1 = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
      title: 'Multi Stale 1',
    })
    const issue2 = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'pending',
      title: 'Multi Stale 2',
    })
    const issue3 = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'completed',
      title: 'Multi Stale 3',
    })

    const count = await reconcileStaleWorkingIssues()
    expect(count).toBeGreaterThanOrEqual(3)

    for (const id of [issue1.id, issue2.id, issue3.id]) {
      const updated = await getIssue(id)
      expect(updated!.statusId).toBe('review')
    }
  })

  test('ignores soft-deleted working issues', async () => {
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
    })

    // Soft-delete the issue
    await db
      .update(issuesTable)
      .set({ isDeleted: 1 })
      .where(eq(issuesTable.id, issue.id))

    await reconcileStaleWorkingIssues()

    const updated = await getIssue(issue.id)
    // Should still be working (soft-deleted, so skipped by reconciler query)
    expect(updated!.statusId).toBe('working')
  })

  test('preserves cancelled sessionStatus when reconciling', async () => {
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'cancelled',
    })

    await reconcileStaleWorkingIssues()

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    expect(updated!.sessionStatus).toBe('cancelled')
  })

  test('preserves failed sessionStatus when reconciling', async () => {
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'failed',
    })

    await reconcileStaleWorkingIssues()

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    expect(updated!.sessionStatus).toBe('failed')
  })
})

// ============================
// startupReconciliation
// ============================

describe('startupReconciliation', () => {
  test('marks running sessionStatus as failed', async () => {
    const issue = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'running',
    })

    await startupReconciliation()

    const updated = await getIssue(issue.id)
    expect(updated!.sessionStatus).toBe('failed')
  })

  test('marks pending sessionStatus as failed', async () => {
    const issue = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'pending',
    })

    await startupReconciliation()

    const updated = await getIssue(issue.id)
    expect(updated!.sessionStatus).toBe('failed')
  })

  test('does not touch completed/failed/cancelled sessions', async () => {
    const completed = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'completed',
    })
    const failed = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'failed',
    })
    const cancelled = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'cancelled',
    })

    await startupReconciliation()

    expect((await getIssue(completed.id))!.sessionStatus).toBe('completed')
    expect((await getIssue(failed.id))!.sessionStatus).toBe('failed')
    expect((await getIssue(cancelled.id))!.sessionStatus).toBe('cancelled')
  })

  test('moves orphaned working issues to review after marking sessions', async () => {
    // Issue with running session stuck in working — simulates server crash
    const issue = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
    })

    await startupReconciliation()

    const updated = await getIssue(issue.id)
    expect(updated!.statusId).toBe('review')
    expect(updated!.sessionStatus).toBe('failed')
  })

  test('handles both session cleanup and working reconciliation together', async () => {
    // Issue 1: working with running session (needs both fixes)
    const workingRunning = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
    })

    // Issue 2: review with pending session (needs session fix only)
    const reviewPending = await createDirectIssue({
      statusId: 'review',
      sessionStatus: 'pending',
    })

    // Issue 3: working with completed session (needs statusId fix only)
    const workingCompleted = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'completed',
    })

    await startupReconciliation()

    const wr = await getIssue(workingRunning.id)
    expect(wr!.statusId).toBe('review')
    expect(wr!.sessionStatus).toBe('failed')

    const rp = await getIssue(reviewPending.id)
    expect(rp!.statusId).toBe('review') // unchanged
    expect(rp!.sessionStatus).toBe('failed')

    const wc = await getIssue(workingCompleted.id)
    expect(wc!.statusId).toBe('review')
    expect(wc!.sessionStatus).toBe('completed') // already terminal
  })

  test('does not touch null sessionStatus', async () => {
    const issue = await createDirectIssue({
      statusId: 'todo',
      sessionStatus: null,
    })

    await startupReconciliation()

    const updated = await getIssue(issue.id)
    expect(updated!.sessionStatus).toBeNull()
    expect(updated!.statusId).toBe('todo')
  })
})
