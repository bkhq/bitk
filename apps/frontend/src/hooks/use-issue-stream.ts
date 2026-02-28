import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { NormalizedLogEntry, SessionStatus } from '@/types/kanban'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys } from './use-kanban'

interface UseIssueStreamOptions {
  projectId: string
  issueId: string | null
  sessionStatus?: SessionStatus | null
  enabled?: boolean
  devMode?: boolean
}

interface UseIssueStreamReturn {
  logs: NormalizedLogEntry[]
  sessionStatus: SessionStatus | null
  hasOlderLogs: boolean
  isLoadingOlder: boolean
  loadOlderLogs: () => void
  clearLogs: () => void
  appendServerMessage: (
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => void
}

const TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled'])

/** Max entries in the live logs array. Older entries are trimmed when SSE pushes beyond this. */
const MAX_LIVE_LOGS = 500

function appendLogWithDedup(
  prev: NormalizedLogEntry[],
  incoming: NormalizedLogEntry,
): NormalizedLogEntry[] {
  // Dedup by messageId (guaranteed unique from server)
  if (incoming.messageId) {
    if (prev.some((entry) => entry.messageId === incoming.messageId))
      return prev
  }

  // Exact duplicate guard (DB refresh + SSE replay)
  const duplicate = prev.some(
    (entry) =>
      entry.entryType === incoming.entryType &&
      (entry.turnIndex ?? null) === (incoming.turnIndex ?? null) &&
      (entry.timestamp ?? null) === (incoming.timestamp ?? null) &&
      entry.content === incoming.content,
  )
  if (duplicate) return prev

  return [...prev, incoming]
}

/** Append and trim oldest entries if the list exceeds MAX_LIVE_LOGS. */
function appendAndTrim(
  prev: NormalizedLogEntry[],
  incoming: NormalizedLogEntry,
): NormalizedLogEntry[] {
  const next = appendLogWithDedup(prev, incoming)
  if (next.length > MAX_LIVE_LOGS) {
    return next.slice(next.length - MAX_LIVE_LOGS)
  }
  return next
}

export function useIssueStream({
  projectId,
  issueId,
  sessionStatus: externalStatus,
  enabled = true,
  devMode = false,
}: UseIssueStreamOptions): UseIssueStreamReturn {
  // Live logs: initial load + SSE entries, capped at MAX_LIVE_LOGS
  const [liveLogs, setLiveLogs] = useState<NormalizedLogEntry[]>([])
  // Older logs: loaded via "Load More", no cap (user-initiated)
  const [olderLogs, setOlderLogs] = useState<NormalizedLogEntry[]>([])

  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    externalStatus ?? null,
  )
  const [hasOlderLogs, setHasOlderLogs] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const queryClient = useQueryClient()

  const doneReceivedRef = useRef(false)
  const activeExecutionRef = useRef<string | null>(null)
  const streamScopeRef = useRef<string | null>(null)
  const olderCursorRef = useRef<string | null>(null)

  // Combined logs for rendering: olderLogs (history) + liveLogs (current window)
  const logs = useMemo(
    () => (olderLogs.length > 0 ? [...olderLogs, ...liveLogs] : liveLogs),
    [olderLogs, liveLogs],
  )

  const clearLogs = useCallback(() => {
    setLiveLogs([])
    setOlderLogs([])
    setHasOlderLogs(false)
    olderCursorRef.current = null
    doneReceivedRef.current = false
    activeExecutionRef.current = null
  }, [])

  /** Append an entry to live logs, auto-trim oldest when exceeding MAX_LIVE_LOGS. */
  const appendEntry = useCallback((incoming: NormalizedLogEntry) => {
    setLiveLogs((prev) => {
      const next = appendAndTrim(prev, incoming)
      if (next.length < prev.length + 1 && next !== prev) {
        // Entries were trimmed from the front — older history exists in DB
        setHasOlderLogs(true)
      }
      return next
    })
  }, [])

  /** Append a user message with a server-assigned messageId */
  const appendServerMessage = useCallback(
    (
      messageId: string,
      content: string,
      metadata?: Record<string, unknown>,
    ) => {
      const trimmed = content.trim()
      if (!trimmed) return
      if (metadata?.type !== 'pending') {
        doneReceivedRef.current = false
      }
      appendEntry({
        messageId,
        entryType: 'user-message',
        content: trimmed,
        timestamp: new Date().toISOString(),
        metadata,
      })
    },
    [appendEntry],
  )

  /** Load older logs into the separate olderLogs array (no cap) */
  const loadOlderLogs = useCallback(() => {
    if (!issueId || !olderCursorRef.current || isLoadingOlder) return
    setIsLoadingOlder(true)

    kanbanApi
      .getIssueLogs(projectId, issueId, { before: olderCursorRef.current })
      .then((data) => {
        if (!data.logs.length) {
          setHasOlderLogs(false)
          olderCursorRef.current = null
          return
        }
        olderCursorRef.current = data.nextCursor
        setHasOlderLogs(data.hasMore)
        setOlderLogs((prev) => {
          // Dedup against existing older logs
          const existingIds = new Set(
            prev.map((e) => e.messageId).filter(Boolean),
          )
          const newEntries = data.logs.filter(
            (e) => !e.messageId || !existingIds.has(e.messageId),
          )
          return [...newEntries, ...prev]
        })
      })
      .catch((err) => {
        console.warn('Failed to load older logs:', err)
      })
      .finally(() => {
        setIsLoadingOlder(false)
      })
  }, [projectId, issueId, isLoadingOlder])

  useEffect(() => {
    if (!issueId || !enabled) {
      streamScopeRef.current = null
      setSessionStatus(externalStatus ?? null)
      clearLogs()
      return
    }

    const scope = `${projectId}:${issueId}`
    if (streamScopeRef.current !== scope) {
      streamScopeRef.current = scope
      setSessionStatus(externalStatus ?? null)
      clearLogs()
    }
  }, [projectId, issueId, enabled, clearLogs, externalStatus])

  useEffect(() => {
    if (!issueId || !enabled) return

    const hasActiveExecution = activeExecutionRef.current !== null
    const next = externalStatus ?? null
    if (!hasActiveExecution || next === 'running' || next === 'pending') {
      setSessionStatus(next)
    }
  }, [issueId, enabled, externalStatus])

  // Fetch latest historical logs from DB (reverse mode — newest first)
  useEffect(() => {
    if (!issueId || !enabled) return

    const scope = `${projectId}:${issueId}`
    let cancelled = false

    kanbanApi
      .getIssueLogs(projectId, issueId)
      .then((data) => {
        if (cancelled || streamScopeRef.current !== scope) return
        setLiveLogs(data.logs)
        setOlderLogs([])
        setHasOlderLogs(data.hasMore)
        olderCursorRef.current = data.nextCursor
      })
      .catch((err) => {
        console.warn('Failed to fetch issue logs:', err)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, issueId, enabled, externalStatus, devMode])

  // Subscribe to live SSE events for this issue.
  useEffect(() => {
    if (!issueId || !enabled) return

    doneReceivedRef.current = false

    const cleanup = { unsub: (() => {}) as () => void }

    cleanup.unsub = eventBus.subscribe(issueId, {
      onLog: (entry) => {
        if (doneReceivedRef.current) return
        appendEntry(entry)
      },
      onState: (data) => {
        if (data.state === 'running' || data.state === 'pending') {
          // New execution started — track its ID and accept logs
          activeExecutionRef.current = data.executionId
          doneReceivedRef.current = false
          setSessionStatus(data.state)
        } else if (TERMINAL.has(data.state)) {
          // Only mark done if this terminal event is from the current execution.
          // Stale settled events from a previous turn (arriving after a new
          // follow-up already emitted 'running') must be ignored to avoid
          // blocking log events for the active execution.
          if (data.executionId === activeExecutionRef.current) {
            doneReceivedRef.current = true
            activeExecutionRef.current = null
            setSessionStatus(data.state)
          }
        }
        // Invalidate React Query so server sessionStatus flows to components
        queryClient.invalidateQueries({
          queryKey: queryKeys.issue(projectId, issueId),
        })
      },
      onDone: () => {
        // doneReceivedRef is already managed by onState (which has executionId
        // to distinguish stale events). onDone only needs to refresh queries.
        queryClient.invalidateQueries({
          queryKey: queryKeys.issue(projectId, issueId),
        })
        queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
      },
    })

    queryClient.invalidateQueries({
      queryKey: queryKeys.issue(projectId, issueId),
    })

    return () => {
      cleanup.unsub()
    }
  }, [projectId, issueId, enabled, queryClient])

  return {
    logs,
    sessionStatus,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    clearLogs,
    appendServerMessage,
  }
}
