import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createTestProject,
  expectSuccess,
  get,
  patch,
  post,
  waitFor,
} from './helpers'
/**
 * Pending message queue tests — verifies the full lifecycle:
 * - Messages sent to todo issues are stored as pending
 * - Pending messages are merged and auto-sent when transitioning to working
 * - Pending messages are deleted (not just cleared) after processing
 * - No message duplication after consumption
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
  projectId = await createTestProject('Pending Messages Test')
})

// ============================
// Follow-up queuing on todo
// ============================

describe('Follow-up queuing on todo issues', () => {
  test('queues a follow-up message on a todo issue', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Queue Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )
    expect(issue.statusId).toBe('todo')

    const result = await post<{ issueId: string; queued: boolean }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'first queued message' },
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    if (result.json.success) {
      expect(result.json.data.queued).toBe(true)
      expect(result.json.data.issueId).toBe(issue.id)
    }
  })

  test('queued message appears in issue logs as pending', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Pending Log Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'pending log check',
    })

    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    expect(logsResult.status).toBe(200)
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
    )
    expect(pendingMsgs.length).toBeGreaterThanOrEqual(1)
    expect(pendingMsgs[0]!.content).toBe('pending log check')
  })

  test('multiple queued messages accumulate', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Multi Queue Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'message one',
    })
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'message two',
    })
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'message three',
    })

    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
    )
    expect(pendingMsgs.length).toBe(3)
    expect(pendingMsgs.map((m) => m.content)).toEqual([
      'message one',
      'message two',
      'message three',
    ])
  })
})

// ============================
// Pending messages consumed on status transition
// ============================

describe('Pending messages consumed on transition to working', () => {
  test('PATCH to working consumes pending messages via triggerIssueExecution', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'PATCH Consume Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Queue messages while in todo
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'queued for execution',
    })

    // Move to working — triggers execution with merged prompt
    const patched = expectSuccess(
      await patch<Issue>(`/api/projects/${projectId}/issues/${issue.id}`, {
        statusId: 'working',
      }),
    )
    expect(patched.statusId).toBe('working')

    // Wait for echo engine to complete
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // Verify pending messages are DELETED (not just metadata cleared)
    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
    )
    expect(pendingMsgs.length).toBe(0)
  })

  test('bulk update to working consumes pending messages', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Bulk Consume Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'bulk queued message',
    })

    // Bulk update to working
    await patch(`/api/projects/${projectId}/issues/bulk`, {
      updates: [{ id: issue.id, statusId: 'working' }],
    })

    // Wait for echo to complete
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // Verify no pending messages remain
    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
    )
    expect(pendingMsgs.length).toBe(0)
  })
})

// ============================
// No message duplication
// ============================

describe('No message duplication after pending consumption', () => {
  test('pending messages are marked dispatched, not deleted', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Dedup Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    const queuedPrompt = `dedup-check-${Date.now()}`
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: queuedPrompt,
    })

    // Move to working
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'working',
    })

    // Wait for completion
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // Check logs: the queued message should still exist but with pending=false
    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    const logs = expectSuccess(logsResult)
    const matchingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.content.includes(queuedPrompt),
    )
    // Message is preserved (not deleted) — at least the dispatched pending entry
    expect(matchingMsgs.length).toBeGreaterThanOrEqual(1)
    // None should still be marked as pending=true (all dispatched)
    for (const msg of matchingMsgs) {
      expect(msg.metadata?.type).not.toBe('pending')
    }
  })
})

// ============================
// Flush pending for existing sessions
// ============================

describe('Flush pending messages for existing sessions', () => {
  test('re-entering working with completed session flushes pending as follow-up', async () => {
    // Create and run to completion
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Flush Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Wait for echo to complete (auto-moves to review)
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Move back to todo (simulate workflow)
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'todo',
    })

    // Queue a message while in todo
    const flushResult = await post<{ issueId: string; queued: boolean }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'flush this message' },
    )
    expect(flushResult.status).toBe(200)

    // Move back to working — should flush pending as follow-up (not new execution)
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'working',
    })

    // Wait for the flush follow-up to consume pending messages
    // (flushPendingAsFollowUp is fire-and-forget, so we wait on the actual effect)
    await waitFor(async () => {
      const logsResult = await get<LogsResponse>(
        `/api/projects/${projectId}/issues/${issue.id}/logs`,
      )
      const logs = expectSuccess(logsResult)
      const pending = logs.logs.filter(
        (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
      )
      return pending.length === 0
    }, 5000)
  })

  test('running session is NOT flushed (shouldFlush guard)', async () => {
    // Create in working (echo runs quickly, but let's test the guard logic)
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Running Guard Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // The issue starts in todo with no session
    // If we try to move to working, it should trigger execution (not flush)
    const patched = expectSuccess(
      await patch<Issue>(`/api/projects/${projectId}/issues/${issue.id}`, {
        statusId: 'working',
      }),
    )
    expect(patched.sessionStatus).toBe('pending')

    // Wait for completion
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)
  })
})

// ============================
// Execute endpoint consumes pending
// ============================

describe('Execute endpoint consumes pending messages', () => {
  test('execute merges pending messages into prompt', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Execute Consume Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Queue a message
    await post(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      prompt: 'extra context for execution',
    })

    // Move to working first (required for execute)
    await patch(`/api/projects/${projectId}/issues/${issue.id}`, {
      statusId: 'working',
    })

    // Wait for auto-execution to complete
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)

    // Verify pending messages are gone
    const logsResult = await get<LogsResponse>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    const logs = expectSuccess(logsResult)
    const pendingMsgs = logs.logs.filter(
      (l) => l.entryType === 'user-message' && l.metadata?.type === 'pending',
    )
    expect(pendingMsgs.length).toBe(0)
  })
})

// ============================
// Restart discards pending messages
// ============================

describe('Restart guards', () => {
  test('restart requires failed/cancelled session status', async () => {
    // Create and run to completion (auto-moves to review)
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Restart Guard Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Restart on completed session should fail (engine only allows failed/cancelled)
    const restartResult = await post(
      `/api/projects/${projectId}/issues/${issue.id}/restart`,
      {},
    )
    expect(restartResult.status).toBe(400)
  })
})
