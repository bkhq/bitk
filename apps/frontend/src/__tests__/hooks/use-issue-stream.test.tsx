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

  it('restores trimmed live entries when loading older logs', async () => {
    // Regression: once live logs exceed MAX_LIVE_LOGS, trimmed entries must
    // remain recoverable via loadOlderLogs (seenIds must be cleared on eviction).
    const MAX_LIVE_LOGS = 500
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    // Start with an empty initial fetch (all entries will come via SSE)
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: [],
      nextCursor: 'cursor-0',
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    // Push MAX_LIVE_LOGS + 10 entries via SSE to trigger trimming
    const totalEntries = MAX_LIVE_LOGS + 10
    const allEntries: NormalizedLogEntry[] = []
    for (let i = 0; i < totalEntries; i++) {
      const ts = new Date(Date.now() + i * 100).toISOString()
      // ULID-like IDs: pad with leading zeros so sort is correct
      const messageId = `01ARZ${String(i).padStart(20, '0')}`
      allEntries.push({
        messageId,
        entryType: 'assistant-message',
        content: `msg-${i}`,
        timestamp: ts,
      })
    }

    act(() => {
      for (const entry of allEntries) {
        handler?.onLog(entry)
      }
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(MAX_LIVE_LOGS)
      expect(result.current.hasOlderLogs).toBe(true)
    })

    // The first 10 entries were trimmed. Simulate server returning them on pagination.
    const trimmedEntries = allEntries.slice(0, 10)
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: trimmedEntries,
      nextCursor: null,
      hasMore: false,
    })

    act(() => {
      result.current.loadOlderLogs()
    })

    await waitFor(() => {
      expect(result.current.isLoadingOlder).toBe(false)
    })

    // All 10 trimmed entries should be restored in olderLogs, visible in merged output
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(MAX_LIVE_LOGS + 10)
    })

    // Verify the first entry is the earliest trimmed one (no gaps)
    expect(result.current.logs[0]?.content).toBe('msg-0')
    // And no duplicates: last entry is the newest
    expect(result.current.logs.at(-1)?.content).toBe(`msg-${totalEntries - 1}`)
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
