import { create } from 'zustand'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

interface TerminalSessionStore {
  terminal: Terminal | null
  fitAddon: FitAddon | null
  sessionId: string | null
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connecting: Promise<void> | null
  initialized: boolean
  disposed: boolean
  set: (partial: Partial<Omit<TerminalSessionStore, 'set' | 'reset'>>) => void
  reset: () => void
}

const initialState = {
  terminal: null,
  fitAddon: null,
  sessionId: null,
  ws: null,
  reconnectTimer: null,
  connecting: null,
  initialized: false,
  disposed: false,
}

export const useTerminalSessionStore = create<TerminalSessionStore>((set) => ({
  ...initialState,
  set: (partial) => set(partial),
  reset: () => set(initialState),
}))
