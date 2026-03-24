import { zValidator } from '@hono/zod-validator'
import { upgradeWebSocket } from 'hono/bun'
import * as z from 'zod'
import { createOpenAPIRouter } from '@/openapi/hono'
import { ProcessManager } from '@/engines/process-manager'
import { spawnNodeSync } from '@/engines/spawn'
import type { Subprocess } from '@/engines/spawn'
import { logger } from '@/logger'

// App-specific env vars that must not leak into terminal PTY processes.
// HOST/PORT would override zsh's %m prompt (e.g. HOST=0.0.0.0 → "0").
const TERMINAL_STRIP_KEYS = new Set([
  // Server
  'HOST',
  'PORT',
  'ROOT_DIR',
  'SERVER_NAME',
  'SERVER_URL',
  // Security
  'API_SECRET',
  'ALLOWED_ORIGIN',
  // Database
  'DB_PATH',
  'BKD_DATA_DIR',
  // Logging
  'LOG_LEVEL',
  'SERVICE_NAME',
  'LOG_EXECUTOR_IO',
  // Engine
  'MAX_CONCURRENT_EXECUTIONS',
  'WORKTREE_DIR',
  // Debug
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
    const result = spawnNodeSync(['getent', 'passwd', user])
    const entry = result.stdout.trim()
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

interface TerminalMeta {
  wsRaw: WsLike | null
  graceTimer: ReturnType<typeof setTimeout> | null
}

const MAX_SESSIONS = 10
const GRACE_PERIOD_MS = 60_000 // keep PTY alive 60s after WS disconnect
const MAX_COLS = 500
const MAX_ROWS = 200

const terminalPM = new ProcessManager<TerminalMeta>('terminal', {
  maxConcurrent: MAX_SESSIONS,
  autoCleanupDelayMs: 0,
  gcIntervalMs: 5 * 60 * 1000,
  killTimeoutMs: 3000,
  logger,
})

function killSession(id: string): void {
  const entry = terminalPM.get(id)
  if (!entry) return
  if (entry.meta.graceTimer) clearTimeout(entry.meta.graceTimer)
  try {
    entry.subprocess.terminal?.close()
  } catch {
    /* already closed */
  }
  terminalPM.forceKill(id)
  terminalPM.remove(id)
}

// Handle PTY exit: close attached WS and remove entry
terminalPM.onExit((entry) => {
  logger.info({ id: entry.id, exitCode: entry.exitCode }, 'terminal_pty_exited')
  if (entry.meta.wsRaw) {
    try {
      entry.meta.wsRaw.close?.(1000, 'PTY exited')
    } catch {
      /* already closed */
    }
  }
  terminalPM.remove(entry.id)
})

// Periodic cleanup: kill sessions older than 24h
const expiryTimer = setInterval(
  () => {
    const now = Date.now()
    const MAX_AGE = 24 * 60 * 60 * 1000
    for (const entry of terminalPM.getActive()) {
      if (now - entry.startedAt.getTime() > MAX_AGE) {
        logger.info({ id: entry.id }, 'terminal_session_expired')
        killSession(entry.id)
      }
    }
  },
  5 * 60 * 1000,
)
if (typeof expiryTimer === 'object' && 'unref' in expiryTimer) {
  ;(expiryTimer as NodeJS.Timeout).unref()
}

// --- Routes ---

const app = createOpenAPIRouter()

// GET /terminal/:id — Check if a terminal session is alive
// NOTE: /terminal/ws/:id below has a static 'ws' segment that Hono's trie router
// matches before this :id param, so there is no conflict.
app.get('/terminal/:id', (c) => {
  const id = c.req.param('id')
  const entry = terminalPM.get(id)
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  return c.json({ success: true, data: { id } })
})

// POST /terminal — Create a new terminal session (spawn PTY)
app.post('/terminal', (c) => {
  const id = crypto.randomUUID()

  // We need a reference the PTY data callback can close over
  // to forward output to the attached WS. The meta object is
  // shared by reference with the PM entry.
  const meta: TerminalMeta = { wsRaw: null, graceTimer: null }

  const proc = Bun.spawn([defaultShell, '-l'], {
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        // Forward PTY output to attached WS (if any)
        if (meta.wsRaw) {
          try {
            meta.wsRaw.send(data)
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
  }) as unknown as Subprocess

  try {
    terminalPM.register(id, proc, meta, {
      group: 'terminal',
      startAsRunning: true,
    })
  } catch {
    // Concurrency limit reached
    proc.kill()
    return c.json({ success: false, error: 'Session limit reached' }, 429)
  }

  logger.info({ id, pid: proc.pid, shell: defaultShell }, 'terminal_session_created')

  return c.json({ success: true, data: { id } })
})

// GET /terminal/ws/:id — WebSocket for bidirectional I/O on an existing session
app.get(
  '/terminal/ws/:id',
  // Reject before upgrade if session doesn't exist
  (c, next) => {
    const id = c.req.param('id') ?? ''
    if (!terminalPM.has(id)) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    return next()
  },
  upgradeWebSocket((c) => {
    const id = c.req.param('id') ?? ''
    // Capture the raw WS ref so onClose can detect stale sockets
    let myWsRaw: WsLike | null = null

    return {
      onOpen(_evt, ws) {
        const entry = terminalPM.get(id)
        if (!entry) {
          ws.close(1008, 'Session not found')
          return
        }

        // Clear grace timer — WS reconnected
        if (entry.meta.graceTimer) {
          clearTimeout(entry.meta.graceTimer)
          entry.meta.graceTimer = null
        }

        // Close previous WS if another client is still connected
        if (entry.meta.wsRaw && entry.meta.wsRaw !== ws.raw) {
          try {
            entry.meta.wsRaw.close?.(4000, 'Replaced by new connection')
          } catch {
            /* already closed */
          }
        }

        myWsRaw = ws.raw as WsLike
        entry.meta.wsRaw = myWsRaw

        logger.info({ id, pid: entry.subprocess.pid }, 'terminal_ws_attached')
      },

      onMessage(evt) {
        const entry = terminalPM.get(id)
        if (!entry?.subprocess?.terminal) return

        const raw =
          evt.data instanceof ArrayBuffer ?
              new Uint8Array(evt.data) :
            typeof evt.data === 'string' ?
                new TextEncoder().encode(evt.data) :
                new Uint8Array(evt.data as ArrayBufferLike)

        if (raw.length === 0) return

        const type = raw[0]

        if (type === 0) {
          // Input: [0x00][...data]
          const input = new TextDecoder().decode(raw.slice(1))
          entry.subprocess.terminal.write(input)
        } else if (type === 1 && raw.length >= 5) {
          // Resize: [0x01][cols:u16BE][rows:u16BE]
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
          const cols = view.getUint16(1, false)
          const rows = view.getUint16(3, false)
          if (cols > 0 && cols <= MAX_COLS && rows > 0 && rows <= MAX_ROWS) {
            entry.subprocess.terminal.resize(cols, rows)
          }
        }
      },

      onClose() {
        const entry = terminalPM.get(id)
        if (!entry) return

        // Ignore stale socket close — a new WS has already taken over
        if (entry.meta.wsRaw !== myWsRaw) return

        entry.meta.wsRaw = null
        logger.info({ id }, 'terminal_ws_detached')

        // Start grace period — keep PTY alive for reconnection
        entry.meta.graceTimer = setTimeout(() => {
          entry.meta.graceTimer = null
          if (!entry.meta.wsRaw) {
            logger.info({ id }, 'terminal_grace_expired')
            killSession(id)
          }
        }, GRACE_PERIOD_MS)
      },

      onError(evt) {
        logger.error({ id, error: String(evt) }, 'terminal_ws_error')
        const entry = terminalPM.get(id)
        if (!entry) return
        // Only act if this is still the active socket
        if (entry.meta.wsRaw === myWsRaw) {
          entry.meta.wsRaw = null
          // Start grace timer here — onClose compares entry.meta.wsRaw (now null)
          // against myWsRaw, sees them differ, and exits early
          if (!entry.meta.graceTimer) {
            entry.meta.graceTimer = setTimeout(() => {
              entry.meta.graceTimer = null
              if (!entry.meta.wsRaw) {
                logger.info({ id }, 'terminal_grace_expired')
                killSession(id)
              }
            }, GRACE_PERIOD_MS)
          }
        }
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
    const entry = terminalPM.get(id)
    if (!entry) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }

    const { cols, rows } = c.req.valid('json')
    try {
      entry.subprocess.terminal?.resize(cols, rows)
    } catch {
      /* terminal closed */
    }
    return c.json({ success: true })
  },
)

// DELETE /terminal/:id — Kill terminal session
app.delete('/terminal/:id', (c) => {
  const id = c.req.param('id')
  const entry = terminalPM.get(id)
  if (!entry) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  logger.info({ id, pid: entry.subprocess.pid }, 'terminal_session_killed')
  killSession(id)

  return c.json({ success: true })
})

export default app
