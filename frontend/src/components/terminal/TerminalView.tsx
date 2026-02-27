import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
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

// --- Singleton state (persists across drawer open/close) ---

let globalTerminal: Terminal | null = null
let globalFitAddon: FitAddon | null = null
let globalSessionId: string | null = null
let globalWs: WebSocket | null = null
let globalReconnectTimer: ReturnType<typeof setTimeout> | null = null
let globalConnecting: Promise<void> | null = null
let globalInitialized = false
let globalDisposed = false

function getOrCreateTerminal(): { terminal: Terminal; fitAddon: FitAddon } {
  if (globalTerminal && globalFitAddon) {
    return { terminal: globalTerminal, fitAddon: globalFitAddon }
  }

  globalDisposed = false

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

  globalTerminal = terminal
  globalFitAddon = fitAddon

  return { terminal, fitAddon }
}

function connectWs(
  sessionId: string,
  terminal: Terminal,
  fitAddon: FitAddon,
): void {
  if (globalDisposed) return
  if (
    globalWs &&
    (globalWs.readyState === WebSocket.OPEN ||
      globalWs.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  const ws = new WebSocket(wsUrl(sessionId))
  ws.binaryType = 'arraybuffer'
  globalWs = ws

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
    globalWs = null

    // PTY exited — session is gone, start fresh on reconnect
    if (evt.reason === 'PTY exited') {
      globalSessionId = null
      if (!globalDisposed) {
        terminal.writeln('\r\n\x1b[90m[session ended, reconnecting...]\x1b[0m')
        globalReconnectTimer = setTimeout(() => {
          globalReconnectTimer = null
          void initConnection(terminal, fitAddon)
        }, 1500)
      }
      return
    }

    // WS disconnected but session may still be alive — reconnect to same session
    if (!globalDisposed && globalSessionId) {
      globalReconnectTimer = setTimeout(() => {
        globalReconnectTimer = null
        if (globalSessionId) {
          connectWs(globalSessionId, terminal, fitAddon)
        }
      }, 2000)
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
  if (globalDisposed) return

  // Already have a live session + WS — skip
  if (
    globalSessionId &&
    globalWs &&
    (globalWs.readyState === WebSocket.OPEN ||
      globalWs.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  // Deduplicate concurrent calls — wait for in-flight connection
  if (globalConnecting) {
    await globalConnecting
    return
  }

  globalConnecting = (async () => {
    try {
      // Create session via REST (works through Vite proxy)
      const sessionId = await createSession()
      globalSessionId = sessionId

      // Connect WS for bidirectional I/O
      connectWs(sessionId, terminal, fitAddon)
    } catch {
      globalReconnectTimer = setTimeout(() => {
        globalReconnectTimer = null
        void initConnection(terminal, fitAddon)
      }, 2000)
    } finally {
      globalConnecting = null
    }
  })()

  await globalConnecting
}

export function TerminalView({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  const handleResize = useCallback(() => {
    if (!globalFitAddon || !globalTerminal) return
    try {
      globalFitAddon.fit()
      if (globalWs?.readyState === WebSocket.OPEN) {
        const { cols, rows } = globalTerminal
        globalWs.send(encodeResize(cols, rows))
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
    if (globalInitialized && terminal.element) {
      if (terminal.element.parentElement !== container) {
        container.appendChild(terminal.element)
      }
    } else {
      terminal.open(container)
      globalInitialized = true
    }

    // Delay fit to ensure container is laid out
    requestAnimationFrame(() => {
      fitAddon.fit()
      void initConnection(terminal, fitAddon)
    })

    // Terminal input → WS binary
    const inputDisposable = terminal.onData((data) => {
      if (globalWs?.readyState === WebSocket.OPEN) {
        globalWs.send(encodeInput(data))
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
  globalDisposed = true
  globalConnecting = null
  if (globalReconnectTimer) {
    clearTimeout(globalReconnectTimer)
    globalReconnectTimer = null
  }
  if (globalWs) {
    globalWs.close()
    globalWs = null
  }
  if (globalSessionId) {
    deleteSession(globalSessionId)
    globalSessionId = null
  }
  if (globalTerminal) {
    globalTerminal.dispose()
    globalTerminal = null
    globalFitAddon = null
  }
  globalInitialized = false
}
