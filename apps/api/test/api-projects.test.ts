import { describe, expect, test } from 'bun:test'
import { expectSuccess, get, patch, post } from './helpers'
/**
 * Projects API tests.
 */
import './setup'

interface Project {
  id: string
  alias: string
  name: string
  description?: string
  directory?: string
  repositoryUrl?: string
  createdAt: string
  updatedAt: string
}

describe('POST /api/projects', () => {
  test('creates a project with name only', async () => {
    const result = await post<Project>('/api/projects', {
      name: 'My Project',
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.name).toBe('My Project')
    expect(data.alias).toBeTruthy()
    expect(data.id).toBeTruthy()
    expect(data.createdAt).toBeTruthy()
  })

  test('creates a project with all fields', async () => {
    const result = await post<Project>('/api/projects', {
      name: 'Full Project',
      alias: `fullproj${Date.now()}`,
      description: 'A test project',
      directory: `/tmp/test-project-${Date.now()}`,
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.name).toBe('Full Project')
    expect(data.alias).toContain('fullproj')
    expect(data.description).toBe('A test project')
  })

  test('rejects empty name', async () => {
    const result = await post<Project>('/api/projects', { name: '' })
    expect(result.status).toBe(400)
  })

  test('auto-generates alias from name', async () => {
    const result = await post<Project>('/api/projects', {
      name: 'TestAutoAlias',
    })
    const data = expectSuccess(result)
    expect(data.alias).toContain('testautoalias')
  })

  test('rejects duplicate directory', async () => {
    const dir = `/tmp/dup-dir-test-${Date.now()}`
    await post<Project>('/api/projects', {
      name: 'First',
      directory: dir,
    })
    const result2 = await post<Project>('/api/projects', {
      name: 'Second',
      directory: dir,
    })
    expect(result2.status).toBe(409)
  })
})

describe('GET /api/projects', () => {
  test('lists all projects', async () => {
    const result = await get<Project[]>('/api/projects')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('GET /api/projects/:id', () => {
  test('gets a project by ID', async () => {
    const created = expectSuccess(await post<Project>('/api/projects', { name: 'GetById' }))
    const result = await get<Project>(`/api/projects/${created.id}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.id).toBe(created.id)
    expect(data.name).toBe('GetById')
  })

  test('gets a project by alias', async () => {
    const created = expectSuccess(
      await post<Project>('/api/projects', { name: 'GetByAlias', alias: 'byalias' }),
    )
    const result = await get<Project>(`/api/projects/${created.alias}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.id).toBe(created.id)
  })

  test('returns 404 for nonexistent project', async () => {
    const result = await get<Project>('/api/projects/nonexistent')
    expect(result.status).toBe(404)
  })
})

describe('PATCH /api/projects/:id', () => {
  test('updates project name', async () => {
    const created = expectSuccess(await post<Project>('/api/projects', { name: 'BeforeUpdate' }))
    const result = await patch<Project>(`/api/projects/${created.id}`, {
      name: 'AfterUpdate',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.name).toBe('AfterUpdate')
  })

  test('updates project description', async () => {
    const created = expectSuccess(await post<Project>('/api/projects', { name: 'DescProject' }))
    const result = await patch<Project>(`/api/projects/${created.id}`, {
      description: 'Updated description',
    })
    const data = expectSuccess(result)
    expect(data.description).toBe('Updated description')
  })

  test('returns 404 for nonexistent project', async () => {
    const result = await patch<Project>('/api/projects/nonexistent', {
      name: 'Update',
    })
    expect(result.status).toBe(404)
  })
})
