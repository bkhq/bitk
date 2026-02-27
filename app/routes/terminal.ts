import type { Subprocess } from 'bun'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../logger'
import { upgradeWebSocket } from '../ws'

// Server-internal secrets that must never be forwarded to terminal PTY processes
const TERMINAL_STRIP_KEYS = new Set([
  'API_SECRET',
  'DB_PATH',
  'ALLOWED_ORIGIN',
  'ENABLE_RUNTIME_ENDPOINT',
])

/**
 * Detect the current user's default login shell.
 * 1. Read from /etc/passwd via getent (most reliable)
 * 2. Fall back to $SHELL env var
 * 3. Final fallback: /bin/sh
 */
function getDefaultShell(): string {
  try {
    const user = process.env.USER || 'root'
    const result = Bun.spawnSync(['getent', 'passwd', user])
    const entry = new TextDecoder().decode(result.stdout).trim()
    const shell = entry.split(':').pop()
    if (shell && shell.startsWith('/')) return shell
  } catch {
    // getent not available
  }

  if (process.env.SHELL) return process.env.SHELL
  return '/bin/sh'
}

const defaultShell = getDefaultShell()

// --- Terminal session manager ---
// Sessions are decoupled from WebSocket connections — a PTY survives
// brief WS disconnects (e.g. network blip, drawer hide/show).

interface WsLike {
  send: (data: unknown) => void
  close?: (code?: number, reason?: string) => void
}

interface TerminalSession {
  id: string
  proc: Subprocess
  wsRaw: WsLike | null
  createdAt: number
  graceTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, TerminalSession>()

const MAX_SESSIONS = 10
const GRACE_PERIOD_MS = 60_000 // keep PTY alive 60s after WS disconnect
const MAX_COLS = 500
const MAX_ROWS = 200

function killSession(session: TerminalSession): void {
  if (session.graceTimer) clearTimeout(session.graceTimer)
  try {
    session.proc.terminal?.close()
  } catch {
    /* already closed */
  }
  session.proc.kill()
  sessions.delete(session.id)
}

// Periodic cleanup: kill sessions older than 24h
setInterval(
  () => {
    const now = Date.now()
    const MAX_AGE = 24 * 60 * 60 * 1000
    for (const [, session] of sessions) {
      if (now - session.createdAt > MAX_AGE) {
        logger.info({ id: session.id }, 'terminal_session_expired')
        killSession(session)
      }
    }
  },
  5 * 60 * 1000,
)

// --- Routes ---

const app = new Hono()

// POST /terminal — Create a new terminal session (spawn PTY)
app.post('/terminal', (c) => {
  if (sessions.size >= MAX_SESSIONS) {
    return c.json({ success: false, error: 'Session limit reached' }, 429)
  }

  const id = crypto.randomUUID()

  const session: TerminalSession = {
    id,
    proc: null!,
    wsRaw: null,
    createdAt: Date.now(),
    graceTimer: null,
  }

  const proc = Bun.spawn([defaultShell, '-l'], {
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        // Forward PTY output to attached WS (if any)
        if (session.wsRaw) {
          try {
            session.wsRaw.send(data)
          } catch {
            /* WS gone */
          }
        }
      },
    },
    cwd: process.env.HOME || '/',
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !TERMINAL_STRIP_KEYS.has(k)),
      ) as Record<string, string>),
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'C.UTF-8',
      LC_CTYPE: process.env.LC_CTYPE || 'C.UTF-8',
    },
  })

  session.proc = proc
  sessions.set(id, session)

  logger.info({ id, pid: proc.pid, shell: defaultShell }, 'terminal_session_created')

  void proc.exited.then((exitCode) => {
    logger.info({ id, exitCode }, 'terminal_pty_exited')
    if (session.wsRaw) {
      try {
        session.wsRaw.close?.(1000, 'PTY exited')
      } catch {
        /* already closed */
      }
    }
    sessions.delete(id)
  })

  return c.json({ success: true, data: { id } })
})

// GET /terminal/ws/:id — WebSocket for bidirectional I/O on an existing session
app.get(
  '/terminal/ws/:id',
  // Reject before upgrade if session doesn't exist
  (c, next) => {
    const id = c.req.param('id')
    if (!sessions.has(id)) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    return next()
  },
  upgradeWebSocket((c) => {
    const id = c.req.param('id')

    return {
      onOpen(_evt, ws) {
        const session = sessions.get(id)
        if (!session) {
          ws.close(1008, 'Session not found')
          return
        }

        // Clear grace timer — WS reconnected
        if (session.graceTimer) {
          clearTimeout(session.graceTimer)
          session.graceTimer = null
        }

        // Detach previous WS (if any)
        session.wsRaw = ws.raw

        logger.info({ id, pid: session.proc.pid }, 'terminal_ws_attached')
      },

      onMessage(evt) {
        const session = sessions.get(id)
        if (!session?.proc?.terminal) return

        const raw =
          evt.data instanceof ArrayBuffer
            ? new Uint8Array(evt.data)
            : typeof evt.data === 'string'
              ? new TextEncoder().encode(evt.data)
              : new Uint8Array(evt.data as ArrayBufferLike)

        if (raw.length === 0) return

        const type = raw[0]

        if (type === 0) {
          // Input: [0x00][...data]
          const input = new TextDecoder().decode(raw.slice(1))
          session.proc.terminal.write(input)
        } else if (type === 1 && raw.length >= 5) {
          // Resize: [0x01][cols:u16BE][rows:u16BE]
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
          const cols = view.getUint16(1, false)
          const rows = view.getUint16(3, false)
          if (cols > 0 && cols <= MAX_COLS && rows > 0 && rows <= MAX_ROWS) {
            session.proc.terminal.resize(cols, rows)
          }
        }
      },

      onClose() {
        const session = sessions.get(id)
        if (!session) return

        session.wsRaw = null
        logger.info({ id }, 'terminal_ws_detached')

        // Start grace period — keep PTY alive for reconnection
        session.graceTimer = setTimeout(() => {
          session.graceTimer = null
          if (!session.wsRaw) {
            logger.info({ id }, 'terminal_grace_expired')
            killSession(session)
          }
        }, GRACE_PERIOD_MS)
      },

      onError(evt) {
        logger.error({ id, error: String(evt) }, 'terminal_ws_error')
        const session = sessions.get(id)
        if (!session) return
        session.wsRaw = null
      },
    }
  }),
)

// POST /terminal/:id/resize — Resize terminal (REST fallback, also supported via WS binary protocol)
app.post(
  '/terminal/:id/resize',
  zValidator(
    'json',
    z.object({
      cols: z.number().int().min(1).max(MAX_COLS),
      rows: z.number().int().min(1).max(MAX_ROWS),
    }),
  ),
  (c) => {
    const id = c.req.param('id')
    const session = sessions.get(id)
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }

    const { cols, rows } = c.req.valid('json')
    try {
      session.proc.terminal?.resize(cols, rows)
    } catch {
      /* terminal closed */
    }
    return c.json({ success: true })
  },
)

// DELETE /terminal/:id — Kill terminal session
app.delete('/terminal/:id', (c) => {
  const id = c.req.param('id')
  const session = sessions.get(id)
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  logger.info({ id, pid: session.proc.pid }, 'terminal_session_killed')
  killSession(session)

  return c.json({ success: true })
})

export default app
