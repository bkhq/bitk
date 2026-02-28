import type { NormalizedLogEntry, SessionStatus } from '@/types/kanban'

export interface IssueEventHandler {
  onLog: (entry: NormalizedLogEntry) => void
  onState: (data: { executionId: string; state: SessionStatus }) => void
  onDone: (data: { finalStatus: SessionStatus }) => void
}

export interface ChangesSummaryData {
  issueId: string
  fileCount: number
  additions: number
  deletions: number
}

type IssueUpdatedListener = (data: {
  issueId: string
  changes: Record<string, unknown>
}) => void
type ChangesSummaryListener = (data: ChangesSummaryData) => void
type IssueActivityListener = (issueId: string) => void
type ConnectionListener = (connected: boolean) => void

const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000
// Fast fixed-interval retry until first successful connection
const INITIAL_RETRY_DELAY = 1_500
// Watchdog fires if no heartbeat received within 2x server interval + buffer
const HEARTBEAT_WATCHDOG_MS = 35_000

class EventBus {
  private es: EventSource | null = null
  private handlers = new Map<string, Set<IssueEventHandler>>()
  private issueUpdatedListeners = new Set<IssueUpdatedListener>()
  private changesSummaryListeners = new Set<ChangesSummaryListener>()
  private issueActivityListeners = new Set<IssueActivityListener>()
  private connectionListeners = new Set<ConnectionListener>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = BASE_RECONNECT_DELAY
  private connected = false
  private hasConnectedOnce = false

  connect(): void {
    if (this.es) return

    const es = new EventSource('/api/events')
    this.es = es

    es.onopen = () => {
      this.connected = true
      this.hasConnectedOnce = true
      this.reconnectDelay = BASE_RECONNECT_DELAY
      this.notifyConnectionChange(true)
      this.resetHeartbeatWatchdog(es)
    }

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          entry: NormalizedLogEntry
        }
        this.dispatch(data.issueId, (h) => h.onLog(data.entry))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('state', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          executionId: string
          state: SessionStatus
        }
        this.dispatch(data.issueId, (h) =>
          h.onState({ executionId: data.executionId, state: data.state }),
        )
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          finalStatus: SessionStatus
        }
        this.dispatch(data.issueId, (h) =>
          h.onDone({ finalStatus: data.finalStatus }),
        )
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('issue-updated', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          changes: Record<string, unknown>
        }
        for (const cb of this.issueUpdatedListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('changes-summary', (e) => {
      try {
        const data = JSON.parse(e.data) as ChangesSummaryData
        for (const cb of this.changesSummaryListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    // Reset watchdog on heartbeat — server sends every 15s
    es.addEventListener('heartbeat', () => {
      this.resetHeartbeatWatchdog(es)
    })

    es.onerror = () => {
      this.clearHeartbeatWatchdog()
      es.close()
      this.es = null
      this.connected = false
      this.notifyConnectionChange(false)

      // Before first successful connection: fast fixed-interval retry
      // After first connection: exponential backoff for reconnections
      const delay = this.hasConnectedOnce
        ? this.reconnectDelay
        : INITIAL_RETRY_DELAY
      if (this.hasConnectedOnce) {
        this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY)
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
    }
  }

  disconnect(): void {
    this.clearHeartbeatWatchdog()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.connected = false
    this.hasConnectedOnce = false
    this.reconnectDelay = BASE_RECONNECT_DELAY
    this.notifyConnectionChange(false)
  }

  subscribe(issueId: string, handler: IssueEventHandler): () => void {
    let set = this.handlers.get(issueId)
    if (!set) {
      set = new Set()
      this.handlers.set(issueId, set)
    }
    set.add(handler)

    return () => {
      set.delete(handler)
      if (set.size === 0) {
        this.handlers.delete(issueId)
      }
    }
  }

  onIssueActivity(listener: IssueActivityListener): () => void {
    this.issueActivityListeners.add(listener)
    return () => {
      this.issueActivityListeners.delete(listener)
    }
  }

  onIssueUpdated(listener: IssueUpdatedListener): () => void {
    this.issueUpdatedListeners.add(listener)
    return () => {
      this.issueUpdatedListeners.delete(listener)
    }
  }

  onChangesSummary(listener: ChangesSummaryListener): () => void {
    this.changesSummaryListeners.add(listener)
    return () => {
      this.changesSummaryListeners.delete(listener)
    }
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    // Immediately notify with current state
    listener(this.connected)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  private dispatch(
    issueId: string,
    fn: (handler: IssueEventHandler) => void,
  ): void {
    const set = this.handlers.get(issueId)
    if (!set) return
    for (const handler of set) {
      try {
        fn(handler)
      } catch {
        /* ignore handler errors */
      }
    }
  }

  private resetHeartbeatWatchdog(es: EventSource): void {
    this.clearHeartbeatWatchdog()
    this.heartbeatWatchdog = setTimeout(() => {
      // No heartbeat received — connection is likely stale, force reconnect
      this.heartbeatWatchdog = null
      es.close()
      this.es = null
      this.connected = false
      this.notifyConnectionChange(false)
      this.reconnectDelay = BASE_RECONNECT_DELAY
      this.connect()
    }, HEARTBEAT_WATCHDOG_MS)
  }

  private clearHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog)
      this.heartbeatWatchdog = null
    }
  }

  private notifyActivity(issueId: string): void {
    for (const listener of this.issueActivityListeners) {
      try {
        listener(issueId)
      } catch {
        /* ignore */
      }
    }
  }

  private notifyConnectionChange(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connected)
      } catch {
        /* ignore */
      }
    }
  }
}

export const eventBus = new EventBus()
