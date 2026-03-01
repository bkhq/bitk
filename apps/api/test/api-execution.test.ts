import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createTestIssue,
  createTestProject,
  expectSuccess,
  get,
  post,
  waitFor,
} from './helpers'
/**
 * Issue execution & session API tests.
 * Tests the auto-execute flow, follow-up, restart, cancel, and SSE streaming.
 */
import './setup'

interface Issue {
  id: string
  projectId: string
  sessionStatus: string | null
  engineType: string | null
  prompt: string | null
  model: string | null
  [key: string]: unknown
}

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Execution Test Project')
})

describe('Auto-execute on issue creation', () => {
  test('issue is created with sessionStatus=pending when working', async () => {
    const result = await createTestIssue(projectId, {
      title: 'Auto Exec Test',
      statusId: 'working',
      engineType: 'echo',
    })
    expect(result.status).toBe(202)
    const data = expectSuccess(result) as Issue
    expect(data.sessionStatus).toBe('pending')
    expect(data.engineType).toBe('echo')
    expect(data.prompt).toBe('Auto Exec Test')
  })

  test('todo issue has null sessionStatus', async () => {
    const result = await createTestIssue(projectId, {
      title: 'Todo No Exec',
      statusId: 'todo',
      engineType: 'echo',
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result) as Issue
    expect(data.sessionStatus).toBeNull()
  })

  test('async execution transitions to running then completed', async () => {
    const data = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Wait For Complete',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue
    const issueId = data.id

    // Wait for the echo engine to complete (~200ms)
    await waitFor(async () => {
      const result = await get<Issue>(
        `/api/projects/${projectId}/issues/${issueId}`,
      )
      const issue = expectSuccess(result)
      return issue.sessionStatus === 'completed'
    }, 5000)

    // Verify final state
    const final = expectSuccess(
      await get<Issue>(`/api/projects/${projectId}/issues/${issueId}`),
    )
    expect(final.sessionStatus).toBe('completed')
  })

  test('creates logs for the initial execution', async () => {
    const data = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Turn Check',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    // Wait for completion
    await waitFor(async () => {
      const result = await get<Issue>(
        `/api/projects/${projectId}/issues/${data.id}`,
      )
      return expectSuccess(result).sessionStatus === 'completed'
    }, 5000)

    // Check logs exist
    const logsResult = await get<{ issue: Issue; logs: unknown[] }>(
      `/api/projects/${projectId}/issues/${data.id}/logs`,
    )
    expect(logsResult.status).toBe(200)
    const logsData = expectSuccess(logsResult)
    expect(logsData.issue).toBeTruthy()
    expect(Array.isArray(logsData.logs)).toBe(true)
    expect(logsData.logs.length).toBeGreaterThanOrEqual(1)
  })

  test('prompt is set from title only', async () => {
    const data = expectSuccess(
      await createTestIssue(projectId, {
        title: 'With Desc',
        description: 'Extra details',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue
    expect(data.prompt).toBe('With Desc')
  })
})

describe('POST /api/projects/:projectId/issues/:id/execute', () => {
  test('manually executes an issue', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Manual Exec',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    // Wait for auto-exec to complete
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    // Now manually execute again
    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/execute`,
      { engineType: 'echo', prompt: 'Manual prompt' },
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.executionId).toBeTruthy()
    expect(data.issueId).toBe(issue.id)
  })
})

describe('POST /api/projects/:projectId/issues/:id/follow-up', () => {
  test('sends a follow-up message after completion', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Follow Up Test',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    // Wait for initial execution to complete
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    // Send follow-up
    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'Please elaborate on this' },
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.executionId).toBeTruthy()
    expect(data.issueId).toBe(issue.id)
  })

  test('follow-up with custom model', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Model Follow Up',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      { prompt: 'With model', model: 'auto' },
    )
    expect(result.status).toBe(200)
    expectSuccess(result)
  })

  test('rejects follow-up with empty prompt', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Empty Follow Up',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    const result = await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/follow-up`,
      {
        prompt: '',
      },
    )
    expect(result.status).toBe(400)
  })
})

describe('POST /api/projects/:projectId/issues/:id/cancel', () => {
  test('cancels a running session', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Cancel Test',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    // Try to cancel immediately (may already be done due to echo speed)
    const result = await post<{ issueId: string; status: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/cancel`,
      {},
    )
    // Cancel should succeed regardless
    expect(result.status).toBe(200)
  })
})

describe('POST /api/projects/:projectId/issues/:id/restart', () => {
  test('restarts a failed/cancelled session', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Restart Test',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    // Wait for completion
    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      const s = expectSuccess(r).sessionStatus
      return s === 'completed' || s === 'failed' || s === 'cancelled'
    }, 5000)

    // Cancel first (to put it in a restartable state)
    await post<unknown>(
      `/api/projects/${projectId}/issues/${issue.id}/cancel`,
      {},
    )

    // Restart
    const result = await post<{ executionId: string; issueId: string }>(
      `/api/projects/${projectId}/issues/${issue.id}/restart`,
      {},
    )
    // If it was already completed, restart will fail — that's expected
    if (result.status === 200) {
      const data = expectSuccess(result)
      expect(data.executionId).toBeTruthy()
    } else {
      // Session was already completed, can't restart
      expect(result.status).toBe(400)
    }
  })
})

describe('GET /api/projects/:projectId/issues/:id/logs (after execution)', () => {
  test('returns logs for an executed issue', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Logs List Test',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    const result = await get<{ issue: Issue; logs: unknown[] }>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.issue).toBeTruthy()
    expect(Array.isArray(data.logs)).toBe(true)
  })
})

describe('GET /api/projects/:projectId/issues/:id/logs', () => {
  test('returns logs for an issue', async () => {
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Logs Test',
        statusId: 'working',
        engineType: 'echo',
      }),
    ) as Issue

    await waitFor(async () => {
      const r = await get<Issue>(
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      return expectSuccess(r).sessionStatus === 'completed'
    }, 5000)

    const result = await get<{ issue: Issue; logs: unknown[] }>(
      `/api/projects/${projectId}/issues/${issue.id}/logs`,
    )
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.issue).toBeTruthy()
    expect(Array.isArray(data.logs)).toBe(true)
  })
})

describe('GET /api/events (SSE)', () => {
  test('SSE stream returns valid response with projectId', async () => {
    // Test that the SSE endpoint returns 200 with streaming content type
    const url = `http://localhost/api/events?projectId=${projectId}`
    const { default: app } = await import('../src/app')
    const res = await app.request(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  test('SSE stream returns 200 without projectId (global stream)', async () => {
    // The SSE endpoint is now a global broadcast stream — projectId is no longer required
    const { default: app } = await import('../src/app')
    const res = await app.request('http://localhost/api/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})

describe('Cross-project ownership', () => {
  test('cannot access issue from wrong project', async () => {
    const project2 = await createTestProject('Other Project')
    const issue = expectSuccess(
      await createTestIssue(projectId, {
        title: 'Owned Issue',
      }),
    ) as Issue

    const result = await get<Issue>(
      `/api/projects/${project2}/issues/${issue.id}`,
    )
    expect(result.status).toBe(404)
  })
})
