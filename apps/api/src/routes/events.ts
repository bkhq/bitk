import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { appEvents } from '@/events'
import {
  getIssueDevMode,
  isVisibleForMode,
} from '@/engines/issue/utils/visibility'
import { logger } from '@/logger'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

const events = new Hono()

// GET /api/events — Global SSE stream
// Broadcasts all issue events. Client-side filtering by project/issue.
events.get('/', async (c) => {
  logger.debug('global_sse_open')

  try {
    return streamSSE(c, async (stream) => {
      let done = false
      let resolveDone: (() => void) | undefined
      const donePromise = new Promise<void>((r) => {
        resolveDone = r
      })

      const stop = () => {
        if (!done) {
          done = true
          resolveDone?.()
        }
      }

      // Detect client disconnect immediately via AbortSignal
      c.req.raw.signal.addEventListener('abort', stop)

      const writeEvent = (event: string, data: unknown) => {
        if (done) return
        stream.writeSSE({ event, data: JSON.stringify(data) }).catch(stop)
      }

      // Subscribe to log events (order 100 — runs after DB persist + ring buffer)
      // Visibility filter applied here at the SSE boundary only, so internal
      // stages (DB persist, failure detection) always process all entries.
      const unsubLog = appEvents.on(
        'log',
        (data) => {
          if (!isVisibleForMode(data.entry, getIssueDevMode(data.issueId)))
            return
          writeEvent('log', { issueId: data.issueId, entry: data.entry })
        },
        { order: 100 },
      )

      // Non-terminal state changes
      const unsubState = appEvents.on('state', (data) => {
        if (TERMINAL.has(data.state)) return // handled by 'done' below
        writeEvent('state', {
          issueId: data.issueId,
          executionId: data.executionId,
          state: data.state,
        })
      })

      // Terminal state (done event comes AFTER DB is updated)
      const unsubDone = appEvents.on('done', (data) => {
        writeEvent('state', {
          issueId: data.issueId,
          executionId: data.executionId,
          state: data.finalStatus,
        })
        writeEvent('done', {
          issueId: data.issueId,
          finalStatus: data.finalStatus,
        })
      })

      // Issue data mutations (status changes, etc.)
      const unsubIssueUpdated = appEvents.on('issue-updated', (data) => {
        writeEvent('issue-updated', data)
      })

      // Changes summary (file count + line stats)
      const unsubChangesSummary = appEvents.on('changes-summary', (data) => {
        writeEvent('changes-summary', data)
      })

      // Heartbeat every 15s — keeps connection alive and detects client disconnect
      const heartbeat = setInterval(() => {
        if (done) return
        writeEvent('heartbeat', { ts: new Date().toISOString() })
      }, 15_000)

      // Wait until stream ends (client disconnect or write error)
      try {
        await donePromise
      } finally {
        clearInterval(heartbeat)
        unsubLog()
        unsubState()
        unsubDone()
        unsubIssueUpdated()
        unsubChangesSummary()
        logger.debug('global_sse_closed')
      }
    })
  } catch (err) {
    logger.error(
      {
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : err,
      },
      'global_sse_error',
    )
    return c.json({ success: false, error: 'Stream error' }, 500)
  }
})

export default events
