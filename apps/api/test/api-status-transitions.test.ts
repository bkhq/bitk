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
 * Status transition tests — verifies the execution lifecycle:
 * - Status guards on execute/follow-up/restart
 * - Auto-move to review after AI completion
 * - SSE issue-updated events
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

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Status Transitions Test')
})

// ---- Helper: create issue in a specific status ----

async function createIssueInStatus(
  statusId: string,
  title = `Issue ${statusId} ${Date.now()}`,
) {
  // Create in todo first, then move if needed
  const created = expectSuccess(
    await post<Issue>(`/api/projects/${projectId}/issues`, {
      title,
      statusId: 'todo',
      engineType: 'echo',
      model: 'auto',
    }),
  )

  if (statusId === 'todo') return created

  // For review: go through working first so echo runs and creates
  // a real session (externalSessionId). The echo engine auto-moves to review
  // after completion, giving us a proper review issue with session data.
  if (statusId === 'review') {
    const moved = expectSuccess(
      await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
        statusId: 'working',
      }),
    )
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${moved.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)
    return expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${moved.id}`),
    )
  }

  // Move to target status via PATCH
  const moved = expectSuccess(
    await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
      statusId,
    }),
  )

  // If we moved to working, echo engine starts executing.
  // Wait for it to complete so we have a clean state.
  if (statusId === 'working') {
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${moved.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed'
    }, 5000)
  }

  // Re-fetch to get current state
  return expectSuccess(
    await get<Issue>(`/api/projects/${projectId}/issues/${moved.id}`),
  )
}

// ============================
// Status guards on execute
// ============================

describe('Execute status guards', () => {
  test('rejects execute on todo issue with 400', async () => {
    const issue = await createIssueInStatus('todo')
    const result = await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/execute`,
      {
        engineType: 'echo',
        prompt: 'test',
      },
    )
    expect(result.status).toBe(400)
    expect(result.json.success).toBe(false)
    if (!result.json.success) {
      expect(result.json.error).toContain('todo')
    }
  })

  test('rejects execute on done issue with 400', async () => {
    const issue = await createIssueInStatus('done')
    const result = await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/execute`,
      {
        engineType: 'echo',
        prompt: 'test',
      },
    )
    expect(result.status).toBe(400)
    expect(result.json.success).toBe(false)
    if (!result.json.success) {
      expect(result.json.error).toContain('done')
    }
  })

  test('allows execute on review issue (moves to working)', async () => {
    const issue = await createIssueInStatus('review')
    expect(issue.statusId).toBe('review')

    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/execute`,
      { engineType: 'echo', prompt: 'test from review' },
    )
    expect(result.status).toBe(200)

    // Issue should now be working (ensureInProgress moved it)
    const after = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`),
    )
    expect(after.statusId).toBe('working')
  })
})

// ============================
// Status guards on follow-up
// ============================

describe('Follow-up status guards', () => {
  test('queues follow-up on todo issue instead of rejecting', async () => {
    const issue = await createIssueInStatus('todo')
    const result = await post<{ issueId: string; queued: boolean }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'hello' },
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    if (result.json.success) {
      expect(result.json.data.queued).toBe(true)
    }
  })

  test('queues follow-up on done issue instead of rejecting', async () => {
    // The follow-up route queues messages for done issues (same as todo) rather than rejecting them
    const issue = await createIssueInStatus('done')
    const result = await post<{ issueId: string; queued: boolean }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'hello' },
    )
    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    if (result.json.success) {
      expect(result.json.data.queued).toBe(true)
    }
  })

  test('allows follow-up on review issue', async () => {
    const issue = await createIssueInStatus('review')
    const result = await post<{ executionId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'follow up from review' },
    )
    expect(result.status).toBe(200)
  })
})

// ============================
// Status guards on restart
// ============================

describe('Restart status guards', () => {
  test('rejects restart on todo issue with 400', async () => {
    const issue = await createIssueInStatus('todo')
    const result = await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/restart`,
      {},
    )
    expect(result.status).toBe(400)
    expect(result.json.success).toBe(false)
  })

  test('rejects restart on done issue with 400', async () => {
    const issue = await createIssueInStatus('done')
    const result = await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/restart`,
      {},
    )
    expect(result.status).toBe(400)
    expect(result.json.success).toBe(false)
  })
})

// ============================
// Auto-move to review after echo completion
// ============================

describe('Auto-move to review after AI completion', () => {
  test('issue created in working moves to review after echo completes', async () => {
    // Create directly in working (triggers auto-execute with echo)
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Auto Review Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )
    expect(created.statusId).toBe('working')
    expect(created.sessionStatus).toBe('pending')

    // Wait for echo to finish AND auto-move to review
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${created.id}`,
      )
      const issue = expectSuccess(r)
      return issue.statusId === 'review'
    }, 5000)

    // Verify final state
    const final = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`),
    )
    expect(final.statusId).toBe('review')
    expect(final.sessionStatus).toBe('completed')
  })

  test('PATCH to working triggers execution and moves to review', async () => {
    // Create in todo
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Patch Move Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )
    expect(created.statusId).toBe('todo')

    // Move to working via PATCH
    const patched = expectSuccess(
      await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
        statusId: 'working',
      }),
    )
    expect(patched.statusId).toBe('working')
    expect(patched.sessionStatus).toBe('pending')

    // Wait for echo to complete and auto-move
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${created.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    const final = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`),
    )
    expect(final.statusId).toBe('review')
    expect(final.sessionStatus).toBe('completed')
  })

  test('bulk update to working triggers execution and moves to review', async () => {
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Bulk Move Test',
        statusId: 'todo',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Bulk update to working
    const result = await patch<Issue[]>(
      `/api/projects/${projectId}/issues/bulk`,
      {
        updates: [{ id: created.id, statusId: 'working' }],
      },
    )
    expect(result.status).toBe(200)

    // Wait for auto-move to review
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${created.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    const final = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`),
    )
    expect(final.statusId).toBe('review')
  })

  test('follow-up on review re-executes then moves back to review', async () => {
    // Create working, wait for completion (auto-moves to review)
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Review Cycle Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${created.id}`,
      )
      return expectSuccess(r).statusId === 'review'
    }, 5000)

    // Now follow-up — should move to working then back to review
    const followUp = await post<{ executionId: string }>(
      `/api/projects/${projectId}/issues/${created.id}/follow-up`,
      { prompt: 'Follow up message' },
    )
    expect(followUp.status).toBe(200)

    // Wait for re-execution to complete and auto-move back to review
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${created.id}`,
      )
      const issue = expectSuccess(r)
      // Must be back review with completed status
      return issue.statusId === 'review' && issue.sessionStatus === 'completed'
    }, 5000)

    const final = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`),
    )
    expect(final.statusId).toBe('review')
    expect(final.sessionStatus).toBe('completed')
  })
})

// ============================
// SSE issue-updated events
// ============================

describe('SSE issue-updated events', () => {
  test('SSE stream sends issue-updated events on status change', async () => {
    const { default: app } = await import('../src/app')

    // Open SSE stream
    const sseRes = await app.request(
      `http://localhost/api/events?projectId=${projectId}`,
    )
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream')

    // Create an issue in working (triggers execution + auto-move)
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'SSE Event Test',
        statusId: 'working',
        engineType: 'echo',
        model: 'auto',
      }),
    )

    // Read SSE events for a few seconds and check for issue-updated
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    const timeout = Date.now() + 5000

    while (Date.now() < timeout) {
      const { done, value } = await Promise.race([
        reader.read(),
        Bun.sleep(100).then(() => ({ done: false, value: undefined })),
      ])
      if (value) received += decoder.decode(value, { stream: true })
      if (done) break
      if (received.includes('issue-updated')) break
    }

    reader.cancel()

    // Verify we got at least one issue-updated event
    expect(received).toContain('event: issue-updated')
    expect(received).toContain(created.id)
  })
})
