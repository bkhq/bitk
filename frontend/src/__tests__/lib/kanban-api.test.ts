import { describe, expect, it, vi, beforeEach } from 'vitest'
import { kanbanApi } from '../../lib/kanban-api'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockJsonResponse<T>(data: T, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ success: true, data }),
  }
}

function mockErrorResponse(error: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: false, error }),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('kanbanApi.getProjects', () => {
  it('calls GET /api/projects', async () => {
    const projects = [{ id: '1', name: 'Test' }]
    mockFetch.mockResolvedValueOnce(mockJsonResponse(projects))

    const result = await kanbanApi.getProjects()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(options?.method).toBeUndefined() // GET is default
    expect(result).toEqual(projects)
  })

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse('Not found'))

    await expect(kanbanApi.getProjects()).rejects.toThrow('Not found')
  })
})

describe('kanbanApi.createProject', () => {
  it('calls POST /api/projects with body', async () => {
    const project = { id: '1', name: 'New Project' }
    mockFetch.mockResolvedValueOnce(mockJsonResponse(project))

    const result = await kanbanApi.createProject({ name: 'New Project' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ name: 'New Project' })
    expect(result).toEqual(project)
  })
})

describe('kanbanApi.updateProject', () => {
  it('calls PATCH /api/projects/:id with body', async () => {
    const project = { id: 'abc', name: 'Updated' }
    mockFetch.mockResolvedValueOnce(mockJsonResponse(project))

    await kanbanApi.updateProject('abc', { name: 'Updated' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/abc')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body as string)).toEqual({ name: 'Updated' })
  })
})

describe('kanbanApi.getIssues', () => {
  it('calls GET /api/projects/:projectId/issues', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse([]))

    await kanbanApi.getIssues('proj-1')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/issues')
  })
})

describe('kanbanApi.autoTitleIssue', () => {
  it('calls POST /api/projects/:projectId/issues/:issueId/auto-title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    })

    await kanbanApi.autoTitleIssue('proj-1', 'issue-1')

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/issues/issue-1/auto-title')
    expect(options.method).toBe('POST')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false, error: 'fail' }),
    })

    await expect(
      kanbanApi.autoTitleIssue('proj-1', 'issue-1'),
    ).rejects.toThrow('Auto-title failed: 500')
  })
})

describe('kanbanApi.followUpIssue', () => {
  it('calls POST with JSON body when no files', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ issueId: 'issue-1' }),
    )

    await kanbanApi.followUpIssue({
      projectId: 'proj-1',
      issueId: 'issue-1',
      prompt: 'Hello',
    })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/issues/issue-1/follow-up')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body as string)
    expect(body.prompt).toBe('Hello')
  })
})

describe('kanbanApi error handling', () => {
  it('throws when success is false', async () => {
    mockFetch.mockResolvedValueOnce(
      mockErrorResponse('Something went wrong'),
    )

    await expect(kanbanApi.getProjects()).rejects.toThrow(
      'Something went wrong',
    )
  })
})
