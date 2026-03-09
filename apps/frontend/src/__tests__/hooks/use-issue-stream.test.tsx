import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssueStream } from '@/hooks/use-issue-stream'
import type { IssueEventHandler } from '@/lib/event-bus'
import type { NormalizedLogEntry } from '@/types/kanban'

const subscribeMock = vi.fn()
const getIssueLogsMock = vi.fn()

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    subscribe: (...args: unknown[]) => subscribeMock(...args),
  },
}))

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    getIssueLogs: (...args: unknown[]) => getIssueLogsMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useIssueStream', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('replaces an existing pending message when log-updated arrives', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    const pendingEntry: NormalizedLogEntry = {
      messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      entryType: 'user-message',
      content: 'queued follow-up',
      timestamp: new Date().toISOString(),
      metadata: { type: 'pending' },
    }

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [pendingEntry],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      {
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
    })
    expect(result.current.logs[0]?.metadata?.type).toBe('pending')

    act(() => {
      handler?.onLogUpdated({
        ...pendingEntry,
        metadata: undefined,
      })
    })

    await waitFor(() => {
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })
  })

  it('prefers the SSE-updated entry over a stale initial snapshot with the same messageId', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    const initialFetch = deferred<{
      issue: null
      logs: NormalizedLogEntry[]
      nextCursor: null
      hasMore: boolean
    }>()

    getIssueLogsMock.mockReturnValue(initialFetch.promise)

    const pendingEntry: NormalizedLogEntry = {
      messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
      entryType: 'user-message',
      content: 'queued follow-up',
      timestamp: new Date().toISOString(),
      metadata: { type: 'pending' },
    }

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      {
        wrapper: createWrapper(),
      },
    )

    act(() => {
      handler?.onLogUpdated({
        ...pendingEntry,
        metadata: undefined,
      })
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })

    initialFetch.resolve({
      issue: null,
      logs: [pendingEntry],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })
  })
})
