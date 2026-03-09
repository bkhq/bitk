import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { issues as issuesTable } from '../src/db/schema'
import { engineRegistry } from '../src/engines/executors'
import { issueEngine } from '../src/engines/issue'
import { api, createTestProject, expectSuccess, get, post, waitFor } from './helpers'
import './setup'

interface Issue {
  id: string
  projectId: string
  statusId: string
  sessionStatus: string | null
  engineType: string | null
  prompt: string | null
  externalSessionId: string | null
  model: string | null
}

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Process State Regression Test')
})

async function createCompletedIssue(title: string): Promise<Issue> {
  const created = expectSuccess(
    await post<Issue>(`/api/projects/${projectId}/issues`, {
      title,
      statusId: 'working',
      engineType: 'echo',
      model: 'auto',
    }),
  )

  await waitFor(async () => {
    const r = await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`)
    return expectSuccess(r).statusId === 'review'
  }, 5000)

  return expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${created.id}`))
}

describe('Execute/Restart spawn failure rollback', () => {
  test('execute spawn failure rolls sessionStatus back to failed', async () => {
    const issue = await createCompletedIssue('Execute rollback issue')
    const executor = engineRegistry.get('echo')
    expect(executor).toBeTruthy()
    if (!executor) return

    const originalSpawn = executor.spawn
    ;(executor as any).spawn = async () => {
      throw new Error('forced execute spawn failure')
    }

    try {
      const result = await post<unknown>(`/api/projects/${projectId}/issues/${issue.id}/execute`, {
        engineType: 'echo',
        prompt: 'force execute failure',
      })
      expect(result.status).toBe(400)

      const refreshed = expectSuccess(
        await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`),
      )
      expect(refreshed.sessionStatus).toBe('failed')
    }
    finally {
      ;(executor as any).spawn = originalSpawn
    }
  })

  test('restart spawn failure keeps sessionStatus as failed', async () => {
    const issue = await createCompletedIssue('Restart rollback issue')
    await db
      .update(issuesTable)
      .set({
        statusId: 'working',
        sessionStatus: 'failed',
        externalSessionId: issue.externalSessionId ?? `test-${Date.now()}`,
      })
      .where(eq(issuesTable.id, issue.id))

    const executor = engineRegistry.get('echo')
    expect(executor).toBeTruthy()
    if (!executor) return

    const originalSpawnFollowUp = executor.spawnFollowUp
    ;(executor as any).spawnFollowUp = async () => {
      throw new Error('forced restart spawn failure')
    }

    try {
      const result = await post<unknown>(
        `/api/projects/${projectId}/issues/${issue.id}/restart`,
        {},
      )
      expect(result.status).toBe(400)

      const refreshed = expectSuccess(
        await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`),
      )
      expect(refreshed.sessionStatus).toBe('failed')
    }
    finally {
      ;(executor as any).spawnFollowUp = originalSpawnFollowUp
    }
  })
})

describe('Delete paths terminate active processes', () => {
  test('issue delete terminates active process and soft-deletes issue', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Issue delete terminate success',
        statusId: 'todo',
      }),
    )
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'running' })
      .where(eq(issuesTable.id, issue.id))

    const terminatedIssueIds: string[] = []
    const originalTerminate = issueEngine.terminateProcess.bind(issueEngine)
    ;(issueEngine as any).terminateProcess = async (issueId: string) => {
      terminatedIssueIds.push(issueId)
    }

    try {
      const result = await api<{ id: string }>(
        'DELETE',
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      expect(result.status).toBe(200)
      expect(expectSuccess(result).id).toBe(issue.id)
      expect(terminatedIssueIds).toEqual([issue.id])

      const deleted = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      expect(deleted.status).toBe(404)
    }
    finally {
      ;(issueEngine as any).terminateProcess = originalTerminate
    }
  })

  test('issue delete proceeds even when terminateProcess fails (best-effort)', async () => {
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${projectId}/issues`, {
        title: 'Issue delete terminate failure',
        statusId: 'todo',
      }),
    )
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'running' })
      .where(eq(issuesTable.id, issue.id))

    const originalTerminate = issueEngine.terminateProcess.bind(issueEngine)
    ;(issueEngine as any).terminateProcess = async () => {
      throw new Error('forced terminate failure')
    }

    try {
      const result = await api<{ id: string }>(
        'DELETE',
        `/api/projects/${projectId}/issues/${issue.id}`,
      )
      // Best-effort: terminate failure is logged but deletion proceeds
      expect(result.status).toBe(200)

      const deleted = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      expect(deleted.status).toBe(404)
    }
    finally {
      ;(issueEngine as any).terminateProcess = originalTerminate
    }
  })

  test('project delete terminates all active issue processes before soft-delete', async () => {
    const project = expectSuccess(
      await post<{ id: string, alias: string }>('/api/projects', {
        name: `Project delete terminate success ${Date.now()}`,
      }),
    )
    const runningIssue = expectSuccess(
      await post<Issue>(`/api/projects/${project.id}/issues`, {
        title: 'Running child issue',
        statusId: 'todo',
      }),
    )
    const pendingIssue = expectSuccess(
      await post<Issue>(`/api/projects/${project.id}/issues`, {
        title: 'Pending child issue',
        statusId: 'todo',
      }),
    )
    const idleIssue = expectSuccess(
      await post<Issue>(`/api/projects/${project.id}/issues`, {
        title: 'Idle child issue',
        statusId: 'todo',
      }),
    )
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'running' })
      .where(eq(issuesTable.id, runningIssue.id))
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'pending' })
      .where(eq(issuesTable.id, pendingIssue.id))

    const terminatedIssueIds: string[] = []
    const originalTerminate = issueEngine.terminateProcess.bind(issueEngine)
    ;(issueEngine as any).terminateProcess = async (issueId: string) => {
      terminatedIssueIds.push(issueId)
    }

    try {
      const result = await api<{ id: string }>('DELETE', `/api/projects/${project.id}`)
      expect(result.status).toBe(200)
      expect(expectSuccess(result).id).toBe(project.id)

      expect(new Set(terminatedIssueIds)).toEqual(new Set([runningIssue.id, pendingIssue.id]))
      expect(terminatedIssueIds.includes(idleIssue.id)).toBe(false)

      const projectAfter = await get<{ id: string }>(`/api/projects/${project.id}`)
      expect(projectAfter.status).toBe(404)
    }
    finally {
      ;(issueEngine as any).terminateProcess = originalTerminate
    }
  })

  test('project delete proceeds even when terminateProcess fails (best-effort)', async () => {
    const project = expectSuccess(
      await post<{ id: string, alias: string }>('/api/projects', {
        name: `Project delete terminate failure ${Date.now()}`,
      }),
    )
    const issue = expectSuccess(
      await post<Issue>(`/api/projects/${project.id}/issues`, {
        title: 'Project delete child issue',
        statusId: 'todo',
      }),
    )
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'pending' })
      .where(eq(issuesTable.id, issue.id))

    const originalTerminate = issueEngine.terminateProcess.bind(issueEngine)
    ;(issueEngine as any).terminateProcess = async () => {
      throw new Error('forced project terminate failure')
    }

    try {
      const result = await api<{ id: string }>('DELETE', `/api/projects/${project.id}`)
      // Best-effort: terminate failure is logged but deletion proceeds
      expect(result.status).toBe(200)

      const deleted = await get<{ id: string }>(`/api/projects/${project.id}`)
      expect(deleted.status).toBe(404)
    }
    finally {
      ;(issueEngine as any).terminateProcess = originalTerminate
    }
  })
})

describe('Auto execute status fallback', () => {
  test('auto-execute marks sessionStatus failed when project directory is outside workspace root', async () => {
    const workspaceRoot = join('/tmp', `bkd-ws-${Date.now()}`)
    const outsideDir = join('/tmp', `bkd-outside-${Date.now()}`)
    mkdirSync(workspaceRoot, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })

    const prevWorkspace = expectSuccess(
      await get<{ path: string }>('/api/settings/workspace-path'),
    ).path

    try {
      const setWorkspace = await api<{ path: string }>('PATCH', '/api/settings/workspace-path', {
        path: workspaceRoot,
      })
      expect(setWorkspace.status).toBe(200)

      const project = expectSuccess(
        await post<{ id: string }>('/api/projects', {
          name: `Outside workspace project ${Date.now()}`,
          directory: outsideDir,
        }),
      )

      const issue = expectSuccess(
        await post<Issue>(`/api/projects/${project.id}/issues`, {
          title: 'outside workspace auto execute',
          statusId: 'working',
          engineType: 'echo',
          model: 'auto',
        }),
      )
      expect(issue.sessionStatus).toBe('pending')

      await waitFor(async () => {
        const r = await get<Issue>(`/api/projects/${project.id}/issues/${issue.id}`)
        return expectSuccess(r).sessionStatus === 'failed'
      }, 5000)
    }
    finally {
      await api<{ path: string }>('PATCH', '/api/settings/workspace-path', {
        path: prevWorkspace,
      })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
