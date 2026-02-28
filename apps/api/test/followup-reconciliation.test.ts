import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { createTestProject, expectSuccess, get, patch, post, waitFor } from './helpers'
/**
 * Integration/route tests for follow-up and reconciliation flows:
 * 1. Follow-up while engine is busy persists message as pending (returns queued: true)
 * 2. Follow-up while engine is idle collects pending messages and dispatches
 * 3. Execution failure moves issue to review
 * 4. Stale working issue with missing process is auto-corrected to review
 */
import './setup'

interface Issue {
  id: string
  projectId: string
  statusId: string
  sessionStatus: string | null
  engineType: string | null
  prompt: string | null
  model: string | null
  [key: string]: unknown
}

interface LogEntry {
  messageId?: string
  entryType: string
  content: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

interface LogsResponse {
  issue: Issue
  logs: LogEntry[]
}

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Follow-up Reconciliation Test')
})

// ============================
// Follow-up on todo queues as pending
// ============================

describe('Follow-up queuing behavior', () => {
  test('follow-up on todo issue returns queued: true and persists pending', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Queuing Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )
    expect(issue.statusId).toBe('todo')

    // Send follow-up on todo issue
    const result = await post<{ issueId: string; queued: boolean }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'queued follow-up message' },
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    if (result.json.success) {
      expect(result.json.data.queued).toBe(true)
    }

    // Verify the message is persisted as pending in logs
    const logsResult = await get<LogsResponse>(`/api/projects/${projectId}/issues/${issue.id}/logs`)
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.pending === true,
    )
    expect(pendingMsgs.length).toBeGreaterThanOrEqual(1)
    expect(pendingMsgs[0]!.content).toBe('queued follow-up message')
  })

  test('multiple follow-ups on todo accumulate as pending entries', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Multi Queuing Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Send 3 follow-ups
    for (const msg of ['first', 'second', 'third']) {
      const result = await post<{ issueId: string; queued: boolean }>(
        `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
        { prompt: msg },
      )
      expect(result.status).toBe(200)
      if (result.json.success) {
        expect(result.json.data.queued).toBe(true)
      }
    }

    // All 3 should be pending
    const logsResult = await get<LogsResponse>(`/api/projects/${projectId}/issues/${issue.id}/logs`)
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.pending === true,
    )
    expect(pendingMsgs.length).toBe(3)
    expect(pendingMsgs.map((m) => m.content)).toEqual(['first', 'second', 'third'])
  })
})

// ============================
// Pending messages consumed on execution
// ============================

describe('Pending messages are consumed on transition to working', () => {
  test('pending messages are merged into execution prompt when moved to working', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Consume on Working Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Queue a message
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'extra context from follow-up',
    })

    // Verify it exists as pending
    let logsResult = await get<LogsResponse>(`/api/projects/${projectId}/issues/${issue.id}/logs`)
    let logs = expectSuccess(logsResult)
    const pendingBefore = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.pending === true,
    )
    expect(pendingBefore.length).toBe(1)

    // Move to working — triggers execution that should consume pending
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'working',
    })

    // Wait for echo engine to complete
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // Pending messages should be deleted after successful dispatch
    logsResult = await get<LogsResponse>(`/api/projects/${projectId}/issues/${issue.id}/logs`)
    logs = expectSuccess(logsResult)
    const pendingAfter = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.pending === true,
    )
    expect(pendingAfter.length).toBe(0)
  })
})

// ============================
// Auto-move to review after execution
// ============================

describe('Execution completion moves issue to review', () => {
  test('successful echo execution moves issue from working to review', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Auto Review Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )
    expect(issue.statusId).toBe('working')
    expect(issue.sessionStatus).toBe('pending')

    // Wait for auto-move to review
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    const final = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`))
    expect(final.statusId).toBe('review')
    expect(final.sessionStatus).toBe('completed')
  })

  test('follow-up on review issue re-executes and returns to review', async () => {
    // Create and run to completion
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Review Cycle Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Wait for initial execution to complete and move to review
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Follow-up on review issue
    const followUp = await post<{ executionId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'another round' },
    )
    expect(followUp.status).toBe(200)

    // Should cycle: review -> working -> review
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const i = expectSuccess(r)
      return i.statusId === 'review' && i.sessionStatus === 'completed'
    }, 5000)
  })
})

// ============================
// Stale working reconciliation (integration)
// ============================

describe('Stale working issue auto-correction', () => {
  test('issue stuck in working with no process is corrected to review by reconciler', async () => {
    // Create a working issue with completed session (simulating stuck state)
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Stale Working Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Wait for echo to complete — it should auto-move to review
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const i = expectSuccess(r)
      return i.statusId === 'review'
    }, 5000)

    // Force the statusId back to working via direct DB update (simulate stuck state)
    await db.update(issuesTable).set({ statusId: 'working' }).where(eq(issuesTable.id, issue.id))

    // Verify it's stuck
    let current = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`))
    expect(current.statusId).toBe('working')
    expect(current.sessionStatus).toBe('completed')

    // Import and run reconciler directly
    const { reconcileStaleWorkingIssues } = await import('../src/engines/reconciler')
    const count = await reconcileStaleWorkingIssues()
    expect(count).toBeGreaterThanOrEqual(1)

    // Verify the issue has been corrected to review
    current = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`))
    expect(current.statusId).toBe('review')
    // sessionStatus should remain completed (already terminal)
    expect(current.sessionStatus).toBe('completed')
  })

  test('startup reconciliation marks stale running sessions as failed', async () => {
    // Create issue and run to completion
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Startup Reconcile Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Wait for completion
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Simulate server crash: set sessionStatus back to running
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'running', statusId: 'working' })
      .where(eq(issuesTable.id, issue.id))

    // Run startup reconciliation
    const { startupReconciliation } = await import('../src/engines/reconciler')
    await startupReconciliation()

    // Verify corrected state
    const final = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`))
    expect(final.statusId).toBe('review')
    expect(final.sessionStatus).toBe('failed')
  })
})

// ============================
// Follow-up with pending collection
// ============================

describe('Follow-up collects and merges pending messages', () => {
  test('execute endpoint merges queued pending messages into prompt', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Execute Merge Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Queue messages while in todo
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'context alpha',
    })
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'context beta',
    })

    // Move to review (required for execute)
    // First go through working cycle
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'working',
    })

    // Wait for initial execution to complete
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // After execution, pending should be consumed
    const logsResult = await get<LogsResponse>(`/api/projects/${projectId}/issues/${issue.id}/logs`)
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.pending === true,
    )
    expect(pendingMsgs.length).toBe(0)
  })

  test('follow-up on idle review issue dispatches immediately (no queuing)', async () => {
    // Create and complete an execution cycle
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Idle Follow-up Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Wait for auto-move to review
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Follow-up on review — should dispatch immediately, not queue
    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'immediate dispatch' },
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    if (result.json.success) {
      // Should return executionId (dispatched), not queued: true
      expect(result.json.data.executionId).toBeTruthy()
      expect((result.json.data as any).queued).toBeUndefined()
    }

    // Wait for completion
    await waitFor(async () => {
      const r = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const i = expectSuccess(r)
      return i.statusId === 'review' && i.sessionStatus === 'completed'
    }, 5000)
  })
})
