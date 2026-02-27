import { create } from 'zustand'

const MIN_HEIGHT = 200
const DEFAULT_HEIGHT_RATIO = 0.4
const MAX_HEIGHT_RATIO = 0.7

function getViewportHeight(): number {
  return typeof window === 'undefined' ? 600 : window.innerHeight
}

function clampHeight(h: number): number {
  const min = MIN_HEIGHT
  const max = getViewportHeight() * MAX_HEIGHT_RATIO
  return Math.max(min, Math.min(h, max))
}

interface TerminalStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  height: number
  open: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setHeight: (h: number) => void
}

export { MIN_HEIGHT as TERMINAL_MIN_HEIGHT }
export const TERMINAL_MAX_HEIGHT_RATIO = MAX_HEIGHT_RATIO

export const useTerminalStore = create<TerminalStore>((set) => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  height: Math.round(getViewportHeight() * DEFAULT_HEIGHT_RATIO),

  open: () => set({ isOpen: true, isMinimized: false }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((s) => {
      // If minimized, restore
      if (s.isMinimized) return { isOpen: true, isMinimized: false }
      return { isOpen: !s.isOpen }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setHeight: (h) => set({ height: clampHeight(h) }),
}))

// Re-clamp height on window resize
if (typeof window !== 'undefined') {
  const KEY = '__terminalStoreResizeAttached'
  if (!(window as Record<string, unknown>)[KEY]) {
    ;(window as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useTerminalStore.getState()
      const clamped = clampHeight(store.height)
      if (clamped !== store.height) {
        store.setHeight(clamped)
      }
    })
  }
}
