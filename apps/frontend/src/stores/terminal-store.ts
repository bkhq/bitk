import { create } from 'zustand'

const MIN_WIDTH = 320
const DEFAULT_WIDTH_RATIO = 0.4
const MAX_WIDTH_RATIO = 0.65

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function clampWidth(w: number): number {
  const min = MIN_WIDTH
  const max = getViewportWidth() * MAX_WIDTH_RATIO
  return Math.max(min, Math.min(w, max))
}

interface TerminalStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  open: () => void
  openFullscreen: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
}

export { MIN_WIDTH as TERMINAL_MIN_WIDTH }
export const TERMINAL_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useTerminalStore = create<TerminalStore>((set) => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),

  open: () => set({ isOpen: true, isMinimized: false }),
  openFullscreen: () =>
    set({ isOpen: true, isMinimized: false, isFullscreen: true }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((s) => {
      if (s.isMinimized) return { isOpen: true, isMinimized: false }
      return { isOpen: !s.isOpen }
    }),
  minimize: () =>
    set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setWidth: (w) => set({ width: clampWidth(w) }),
}))

// Re-clamp width on window resize
if (typeof window !== 'undefined') {
  const KEY = '__terminalStoreResizeAttached'
  if (!(window as Record<string, unknown>)[KEY]) {
    ;(window as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useTerminalStore.getState()
      const clamped = clampWidth(store.width)
      if (clamped !== store.width) {
        store.setWidth(clamped)
      }
    })
  }
}
