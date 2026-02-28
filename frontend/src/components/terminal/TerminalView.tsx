import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalSessionStore } from '@/stores/terminal-session-store'
import '@xterm/xterm/css/xterm.css'

// --- Binary protocol helpers ---

function encodeInput(data: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(data)
  const buf = new Uint8Array(1 + encoded.length)
  buf[0] = 0x00
  buf.set(encoded, 1)
  return buf.buffer
}

function encodeResize(cols: number, rows: number): ArrayBuffer {
  const buf = new ArrayBuffer(5)
  const view = new DataView(buf)
  view.setUint8(0, 0x01)
  view.setUint16(1, cols, false)
  view.setUint16(3, rows, false)
  return buf
}

// --- API helpers ---

async function createSession(): Promise<string> {
  const res = await fetch('/api/terminal', { method: 'POST' })
  const json = await res.json()
  if (!json.success) throw new Error(json.error)
  return json.data.id as string
}

function deleteSession(sessionId: string): void {
  void fetch(`/api/terminal/${sessionId}`, { method: 'DELETE' })
}

function wsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Bun runtime lacks socket.destroySoon() — Vite WS proxy crashes.
  // In dev mode, connect directly to API server to bypass Vite proxy.
  const host = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_API_PORT || 3010}`
    : location.host
  return `${proto}//${host}/api/terminal/ws/${sessionId}`
}

// --- Store-backed singleton helpers ---

const store = useTerminalSessionStore

function getOrCreateTerminal(): { terminal: Terminal; fitAddon: FitAddon } {
  const state = store.getState()
  if (state.terminal && state.fitAddon) {
    return { terminal: state.terminal, fitAddon: state.fitAddon }
  }

  store.getState().set({ disposed: false })

  const fitAddon = new FitAddon()
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      selectionBackground: '#3a3a5c',
    },
    allowProposedApi: true,
  })

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  store.getState().set({ terminal, fitAddon })

  return { terminal, fitAddon }
}

function connectWs(
  sessionId: string,
  terminal: Terminal,
  fitAddon: FitAddon,
): void {
  const state = store.getState()
  if (state.disposed) return
  if (
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN ||
      state.ws.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  const ws = new WebSocket(wsUrl(sessionId))
  ws.binaryType = 'arraybuffer'
  store.getState().set({ ws })

  ws.addEventListener('open', () => {
    fitAddon.fit()
    const { cols, rows } = terminal
    ws.send(encodeResize(cols, rows))
  })

  ws.addEventListener('message', (evt) => {
    if (evt.data instanceof ArrayBuffer) {
      terminal.write(new Uint8Array(evt.data))
    }
  })

  ws.addEventListener('close', (evt) => {
    store.getState().set({ ws: null })

    // PTY exited — session is gone, start fresh on reconnect
    if (evt.reason === 'PTY exited') {
      store.getState().set({ sessionId: null })
      if (!store.getState().disposed) {
        terminal.writeln('\r\n\x1b[90m[session ended, reconnecting...]\x1b[0m')
        const timer = setTimeout(() => {
          store.getState().set({ reconnectTimer: null })
          void initConnection(terminal, fitAddon)
        }, 1500)
        store.getState().set({ reconnectTimer: timer })
      }
      return
    }

    // WS disconnected but session may still be alive — reconnect to same session
    const currentState = store.getState()
    if (!currentState.disposed && currentState.sessionId) {
      const timer = setTimeout(() => {
        store.getState().set({ reconnectTimer: null })
        const s = store.getState()
        if (s.sessionId) {
          connectWs(s.sessionId, terminal, fitAddon)
        }
      }, 2000)
      store.getState().set({ reconnectTimer: timer })
    }
  })

  ws.addEventListener('error', () => {
    ws.close()
  })
}

async function initConnection(
  terminal: Terminal,
  fitAddon: FitAddon,
): Promise<void> {
  const state = store.getState()
  if (state.disposed) return

  // Already have a live session + WS — skip
  if (
    state.sessionId &&
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN ||
      state.ws.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  // Deduplicate concurrent calls — wait for in-flight connection
  if (state.connecting) {
    await state.connecting
    return
  }

  const connectingPromise = (async () => {
    try {
      // Create session via REST (works through Vite proxy)
      const sessionId = await createSession()
      store.getState().set({ sessionId })

      // Connect WS for bidirectional I/O
      connectWs(sessionId, terminal, fitAddon)
    } catch {
      const timer = setTimeout(() => {
        store.getState().set({ reconnectTimer: null })
        void initConnection(terminal, fitAddon)
      }, 2000)
      store.getState().set({ reconnectTimer: timer })
    } finally {
      store.getState().set({ connecting: null })
    }
  })()

  store.getState().set({ connecting: connectingPromise })

  await connectingPromise
}

export function TerminalView({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  const handleResize = useCallback(() => {
    const state = store.getState()
    if (!state.fitAddon || !state.terminal) return
    try {
      state.fitAddon.fit()
      if (state.ws?.readyState === WebSocket.OPEN) {
        const { cols, rows } = state.terminal
        state.ws.send(encodeResize(cols, rows))
      }
    } catch {
      // fit() can throw if not visible
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { terminal, fitAddon } = getOrCreateTerminal()

    if (mountedRef.current) return
    mountedRef.current = true

    // Re-mount: reattach existing DOM element instead of calling open() again
    const state = store.getState()
    if (state.initialized && terminal.element) {
      if (terminal.element.parentElement !== container) {
        container.appendChild(terminal.element)
      }
    } else {
      terminal.open(container)
      store.getState().set({ initialized: true })
    }

    // Delay fit to ensure container is laid out
    requestAnimationFrame(() => {
      fitAddon.fit()
      void initConnection(terminal, fitAddon)
    })

    // Terminal input -> WS binary
    const inputDisposable = terminal.onData((data) => {
      const s = store.getState()
      if (s.ws?.readyState === WebSocket.OPEN) {
        s.ws.send(encodeInput(data))
      }
    })

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)

    return () => {
      mountedRef.current = false
      inputDisposable.dispose()
      resizeObserver.disconnect()
      // Do NOT dispose terminal or close WS — they persist across mounts
    }
  }, [handleResize])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
    />
  )
}

/** Explicitly kill the terminal session and clean up all resources */
export function disposeTerminal(): void {
  const state = store.getState()
  store.getState().set({ disposed: true, connecting: null })
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
  }
  if (state.ws) {
    state.ws.close()
  }
  if (state.sessionId) {
    deleteSession(state.sessionId)
  }
  if (state.terminal) {
    state.terminal.dispose()
  }
  store.getState().reset()
}
