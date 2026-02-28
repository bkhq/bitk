import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { issueEngine } from '../engines/issue'
import { onChangesSummary } from '../events/changes-summary'
import { onIssueUpdated } from '../events/issue-events'
import { logger } from '../logger'

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

      // Subscribe to log events
      const unsubLog = issueEngine.onLog((issueId, executionId, entry) => {
        writeEvent('log', { issueId, entry })
      })

      // Non-terminal state changes
      const unsubState = issueEngine.onStateChange((issueId, executionId, state) => {
        if (TERMINAL.has(state)) return // handled by onIssueSettled below
        writeEvent('state', { issueId, executionId, state })
      })

      // Terminal state changes come AFTER DB is updated
      const unsubSettled = issueEngine.onIssueSettled((issueId, executionId, state) => {
        writeEvent('state', { issueId, executionId, state })
        writeEvent('done', { issueId, finalStatus: state })
      })

      // Issue data mutations (status changes, etc.)
      const unsubIssueUpdated = onIssueUpdated((data) => {
        writeEvent('issue-updated', data)
      })

      // Changes summary (file count + line stats)
      const unsubChangesSummary = onChangesSummary((summary) => {
        writeEvent('changes-summary', summary)
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
        unsubSettled()
        unsubIssueUpdated()
        unsubChangesSummary()
        logger.debug('global_sse_closed')
      }
    })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
      'global_sse_error',
    )
    return c.json({ success: false, error: 'Stream error' }, 500)
  }
})

export default events
