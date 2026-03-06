import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import type { NormalizedLogEntry, SessionStatus } from '@/types/kanban'
import { queryKeys } from './use-kanban'

interface UseIssueStreamOptions {
  projectId: string
  issueId: string | null
  sessionStatus?: SessionStatus | null
  enabled?: boolean
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

function contentKey(entry: NormalizedLogEntry): string {
  return `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
}

/**
 * Sort comparator using ULID messageId for chronological order.
 * ULID is lexicographically sortable (first 10 chars encode ms timestamp).
 * Uses simple string comparison (not localeCompare) to guarantee correct
 * byte-level ordering of Crockford Base32 characters across all locales.
 * Entries without messageId (streaming deltas) sort after persisted entries.
 */
function compareByMessageId(
  a: NormalizedLogEntry,
  b: NormalizedLogEntry,
): number {
  if (a.messageId && b.messageId) {
    return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0
  }
  // Streaming deltas (no messageId) stay after persisted entries
  if (a.messageId && !b.messageId) return -1
  if (!a.messageId && b.messageId) return 1
  // Both lack messageId — preserve insertion order (stable sort)
  return 0
}

function mergeLogsPreferLive(
  snapshotLogs: NormalizedLogEntry[],
  liveLogs: NormalizedLogEntry[],
): NormalizedLogEntry[] {
  if (liveLogs.length === 0) return snapshotLogs

  const liveById = new Map(
    liveLogs
      .filter((entry) => entry.messageId)
      .map((entry) => [entry.messageId!, entry]),
  )

  const mergedSnapshot = snapshotLogs.map((entry) => {
    if (!entry.messageId) return entry
    return liveById.get(entry.messageId) ?? entry
  })

  const snapshotIds = new Set(
    snapshotLogs.map((entry) => entry.messageId).filter(Boolean),
  )
  const liveOnly = liveLogs.filter(
    (entry) => entry.messageId && !snapshotIds.has(entry.messageId),
  )

  return [...mergedSnapshot, ...liveOnly].sort(compareByMessageId)
}

export function useIssueStream({
  projectId,
  issueId,
  sessionStatus: externalStatus,
  enabled = true,
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
  const liveLogsRef = useRef<NormalizedLogEntry[]>([])
  const olderLogsRef = useRef<NormalizedLogEntry[]>([])

  // ---- MessageId-based dedup tracking ----
  // O(1) lookup instead of scanning the entire array on every append.
  const seenIdsRef = useRef(new Set<string>())
  // Fallback dedup for entries without messageId (streaming deltas)
  const seenContentKeysRef = useRef(new Set<string>())

  // Combined logs for rendering: olderLogs (history) + liveLogs (current window).
  // Always sort by ULID and dedup by messageId — this is the final safety net
  // that guarantees correct chronological order and no duplicates regardless
  // of how entries arrived (HTTP fetch, SSE, optimistic append, race conditions).
  const logs = useMemo(() => {
    const combined =
      olderLogs.length > 0 ? [...olderLogs, ...liveLogs] : liveLogs
    if (combined.length === 0) return combined

    const sorted = (olderLogs.length > 0 ? combined : [...combined]).sort(
      compareByMessageId,
    )

    // Dedup by messageId (keep first occurrence after sort)
    const deduped = new Set<string>()
    return sorted.filter((entry) => {
      if (!entry.messageId) return true
      if (deduped.has(entry.messageId)) return false
      deduped.add(entry.messageId)
      return true
    })
  }, [olderLogs, liveLogs])

  const clearLogs = useCallback(() => {
    liveLogsRef.current = []
    olderLogsRef.current = []
    setLiveLogs([])
    setOlderLogs([])
    setHasOlderLogs(false)
    olderCursorRef.current = null
    doneReceivedRef.current = false
    activeExecutionRef.current = null
    seenIdsRef.current.clear()
    seenContentKeysRef.current.clear()
  }, [])

  /** Register an entry's identity into the seen sets. */
  const markSeen = useCallback((entry: NormalizedLogEntry) => {
    if (entry.messageId) {
      seenIdsRef.current.add(entry.messageId)
    } else {
      seenContentKeysRef.current.add(contentKey(entry))
    }
  }, [])

  /** Check if an entry has already been seen. */
  const isSeen = useCallback((entry: NormalizedLogEntry): boolean => {
    if (entry.messageId) {
      return seenIdsRef.current.has(entry.messageId)
    }
    return seenContentKeysRef.current.has(contentKey(entry))
  }, [])

  /** Append an entry to live logs, auto-trim oldest when exceeding MAX_LIVE_LOGS. */
  const appendEntry = useCallback(
    (incoming: NormalizedLogEntry) => {
      setLiveLogs((prev) => {
        if (isSeen(incoming)) return prev
        markSeen(incoming)
        const next = [...prev, incoming]
        if (next.length > MAX_LIVE_LOGS) {
          const trimmed = next.slice(next.length - MAX_LIVE_LOGS)
          liveLogsRef.current = trimmed
          setHasOlderLogs(true)
          return trimmed
        }
        liveLogsRef.current = next
        return next
      })
    },
    [isSeen, markSeen],
  )

  /** Replace an existing entry by messageId; append if the entry is not present yet. */
  const upsertEntry = useCallback(
    (incoming: NormalizedLogEntry) => {
      if (!incoming.messageId) {
        appendEntry(incoming)
        return
      }

      if (
        olderLogsRef.current.some((entry) => entry.messageId === incoming.messageId)
      ) {
        setOlderLogs((prev) => {
          const next = prev.map((entry) =>
            entry.messageId === incoming.messageId ? incoming : entry,
          )
          olderLogsRef.current = next
          return next
        })
        return
      }

      if (
        liveLogsRef.current.some((entry) => entry.messageId === incoming.messageId)
      ) {
        setLiveLogs((prev) => {
          const next = prev.map((entry) =>
            entry.messageId === incoming.messageId ? incoming : entry,
          )
          liveLogsRef.current = next
          return next
        })
        return
      }

      appendEntry(incoming)
    },
    [appendEntry],
  )

  /** Append a user message with a server-assigned messageId */
  const appendServerMessage = useCallback(
    (
      messageId: string,
      content: string,
      metadata?: Record<string, unknown>,
    ) => {
      const trimmed = content.trim()
      const hasAttachments =
        Array.isArray(metadata?.attachments) &&
        (metadata.attachments as unknown[]).length > 0
      // Allow messages with attachments even if text content is empty
      if (!trimmed && !hasAttachments) return
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
          const newEntries = data.logs.filter((e) => {
            if (e.messageId && seenIdsRef.current.has(e.messageId)) return false
            if (e.messageId) seenIdsRef.current.add(e.messageId)
            return true
          })
          const next = [...newEntries, ...prev].sort(compareByMessageId)
          olderLogsRef.current = next
          return next
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

  // Fetch latest historical logs from DB (reverse mode — newest first).
  // Merges with any SSE entries that may have arrived before the HTTP response.
  useEffect(() => {
    if (!issueId || !enabled) return

    const scope = `${projectId}:${issueId}`
    let cancelled = false

    kanbanApi
      .getIssueLogs(projectId, issueId)
      .then((data) => {
        if (cancelled || streamScopeRef.current !== scope) return

        // Merge instead of wholesale replacement: SSE entries that arrived
        // before this HTTP response should be preserved, not overwritten.
        // After merging, sort by messageId (ULID) to guarantee chronological order.
        setLiveLogs((prev) => {
          // Register all DB entries in seenIds
          for (const entry of data.logs) {
            markSeen(entry)
          }

          if (prev.length === 0) {
            // Fast path: no SSE entries arrived yet, just use the DB snapshot
            liveLogsRef.current = data.logs
            return data.logs
          }

          // Prefer any in-memory SSE-updated entry when the same messageId is
          // also present in the DB snapshot. This prevents a stale initial
          // fetch from overwriting a newer log-updated event that arrived first.
          const next = mergeLogsPreferLive(data.logs, prev)
          liveLogsRef.current = next
          return next
        })

        olderLogsRef.current = []
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
    // NOTE: externalStatus is intentionally excluded. The SSE handler already
    // merges new entries in real time via appendEntry. Re-fetching the entire
    // log window on every status transition (running → completed) causes a
    // race: the HTTP response can overwrite SSE entries that arrived between
    // the request and response, making messages appear/disappear/reappear.
  }, [projectId, issueId, enabled, markSeen])

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
      onLogUpdated: (entry) => {
        upsertEntry(entry)
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
  }, [projectId, issueId, enabled, queryClient, appendEntry, upsertEntry])

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
