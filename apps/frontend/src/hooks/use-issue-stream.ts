import { useCallback, useEffect, useRef, useState } from 'react'
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
  clearLogs: () => void
  appendServerMessage: (
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => void
}

const TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled'])

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

export function useIssueStream({
  projectId,
  issueId,
  sessionStatus: externalStatus,
  enabled = true,
  devMode = false,
}: UseIssueStreamOptions): UseIssueStreamReturn {
  const [logs, setLogs] = useState<NormalizedLogEntry[]>([])
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    externalStatus ?? null,
  )
  const queryClient = useQueryClient()

  const doneReceivedRef = useRef(false)
  const activeExecutionRef = useRef<string | null>(null)
  const streamScopeRef = useRef<string | null>(null)

  const clearLogs = useCallback(() => {
    setLogs([])
    doneReceivedRef.current = false
    activeExecutionRef.current = null
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
      setLogs((prev) =>
        appendLogWithDedup(prev, {
          messageId,
          entryType: 'user-message',
          content: trimmed,
          timestamp: new Date().toISOString(),
          metadata,
        }),
      )
    },
    [],
  )

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

  // Always fetch historical logs from DB (survives server restart)
  useEffect(() => {
    if (!issueId || !enabled) return

    const scope = `${projectId}:${issueId}`
    let cancelled = false

    kanbanApi
      .getIssueLogs(projectId, issueId)
      .then((data) => {
        if (cancelled || streamScopeRef.current !== scope) return
        setLogs(data.logs)
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
        setLogs((prev) => appendLogWithDedup(prev, entry))
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
    clearLogs,
    appendServerMessage,
  }
}
