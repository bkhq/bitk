import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectSuccess, get, patch, post } from './helpers'
/**
 * Issues CRUD API tests.
 */
import './setup'

interface Issue {
  id: string
  projectId: string
  statusId: string
  issueNumber: number
  title: string
  description: string | null
  priority: string
  sortOrder: number
  parentIssueId: string | null
  useWorktree: boolean
  childCount?: number
  engineType: string | null
  sessionStatus: string | null
  prompt: string | null
  model: string | null
  createdAt: string
  updatedAt: string
}

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Issues Test Project')
})

describe('POST /api/projects/:projectId/issues', () => {
  test('creates an issue with minimal fields', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Test Issue',
      statusId: 'todo',
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.title).toBe('Test Issue')
    expect(data.statusId).toBe('todo')
    expect(data.priority).toBe('medium') // default
    expect(data.projectId).toBe(projectId)
    expect(data.issueNumber).toBeGreaterThan(0)
    expect(data.id).toBeTruthy()
  })

  test('creates an issue with all fields', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Full Issue',
      statusId: 'working',
      priority: 'high',
      description: 'Detailed description',
      engineType: 'echo',
      model: 'auto',
    })
    expect(result.status).toBe(202)
    const data = expectSuccess(result)
    expect(data.title).toBe('Full Issue')
    expect(data.statusId).toBe('working')
    expect(data.priority).toBe('high')
    expect(data.engineType).toBe('echo')
    expect(data.model).toBe('auto')
  })

  test('auto-assigns sessionStatus=pending when created working', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Auto Execute',
      statusId: 'working',
      engineType: 'echo',
    })
    expect(result.status).toBe(202)
    const data = expectSuccess(result)
    expect(data.sessionStatus).toBe('pending')
    expect(data.prompt).toBeTruthy()
  })

  test('sets prompt from title when no description', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'My Task Title',
      statusId: 'todo',
      engineType: 'echo',
    })
    const data = expectSuccess(result)
    expect(data.prompt).toBe('My Task Title')
  })

  test('sets prompt from title only (description not included)', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Title',
      statusId: 'todo',
      description: 'Details here',
      engineType: 'echo',
    })
    const data = expectSuccess(result)
    expect(data.prompt).toBe('Title')
  })

  test('increments issueNumber sequentially', async () => {
    const r1 = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Seq 1',
        statusId: 'todo',
      }),
    )
    const r2 = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Seq 2',
        statusId: 'todo',
      }),
    )
    expect(r2.issueNumber).toBe(r1.issueNumber + 1)
  })

  test('rejects empty title', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: '',
      statusId: 'todo',
    })
    expect(result.status).toBe(400)
  })

  test('rejects invalid statusId', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Bad Status',
      statusId: 'invalid-status',
    })
    expect(result.status).toBe(400)
  })

  test('rejects invalid priority', async () => {
    const result = await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Bad Priority',
      statusId: 'todo',
      priority: 'super-urgent',
    })
    expect(result.status).toBe(400)
  })

  test('returns 404 for nonexistent project', async () => {
    const result = await post<Issue>('/api/projects/nonexistent/issues', {
      title: 'Test',
      statusId: 'todo',
    })
    expect(result.status).toBe(404)
  })
})

describe('GET /api/projects/:projectId/issues', () => {
  test('lists all issues', async () => {
    const result = await get<Issue[]>(`/api/projects/${projectId}/issues`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('GET /api/projects/:projectId/issues/:id', () => {
  test('gets an issue by ID', async () => {
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'GetById Issue',
        statusId: 'todo',
      }),
    )
    const result = await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.id).toBe(created.id)
    expect(data.title).toBe('GetById Issue')
  })

  test('returns 404 for nonexistent issue', async () => {
    const result = await get<Issue>(`/api/projects/${projectId}/issues/nonexistent`)
    expect(result.status).toBe(404)
  })
})

describe('PATCH /api/projects/:projectId/issues/:id', () => {
  test('updates issue title', async () => {
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Before',
        statusId: 'todo',
      }),
    )
    const result = await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
      title: 'After',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.title).toBe('After')
  })

  test('updates issue priority', async () => {
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Priority Test',
        statusId: 'todo',
      }),
    )
    const result = await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
      priority: 'urgent',
    })
    const data = expectSuccess(result)
    expect(data.priority).toBe('urgent')
  })

  test('updates issue status', async () => {
    const created = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Status Test',
        statusId: 'todo',
      }),
    )
    const result = await patch<Issue>(`/api/projects/${projectId}/issues/${created.id}`, {
      statusId: 'working',
    })
    const data = expectSuccess(result)
    expect(data.statusId).toBe('working')
  })

  test('returns 404 for nonexistent issue', async () => {
    const result = await patch<Issue>(`/api/projects/${projectId}/issues/nonexistent`, {
      title: 'Update',
    })
    expect(result.status).toBe(404)
  })
})

describe('PATCH /api/projects/:projectId/issues/bulk', () => {
  test('bulk updates multiple issues', async () => {
    const i1 = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Bulk 1',
        statusId: 'todo',
      }),
    )
    const i2 = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Bulk 2',
        statusId: 'todo',
      }),
    )
    const result = await patch<Issue[]>(`/api/projects/${projectId}/issues/bulk`, {
      updates: [
        { id: i1.id, statusId: 'working', sortOrder: 0 },
        { id: i2.id, statusId: 'done', sortOrder: 1 },
      ],
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBe(2)
  })
})

describe('Parent/Child issues', () => {
  test('creates a child issue', async () => {
    const parent = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Parent',
        statusId: 'todo',
      }),
    )
    const child = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Child',
        statusId: 'todo',
        parentIssueId: parent.id,
      }),
    )
    expect(child.parentIssueId).toBe(parent.id)

    // Get parent — should include child count
    const parentDetail = expectSuccess(
      await get<Issue & { children: Issue[] }>(`/api/projects/${projectId}/issues/${parent.id}`),
    )
    expect(parentDetail.childCount).toBe(1)
  })
})
