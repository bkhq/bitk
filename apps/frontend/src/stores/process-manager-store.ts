import { create } from 'zustand'

const MIN_WIDTH = 320
const DEFAULT_WIDTH_RATIO = 0.35
const MAX_WIDTH_RATIO = 0.6

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function clampWidth(w: number): number {
  const min = MIN_WIDTH
  const max = getViewportWidth() * MAX_WIDTH_RATIO
  return Math.max(min, Math.min(w, max))
}

interface ProcessManagerStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  open: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
}

export { MIN_WIDTH as PROCESS_MANAGER_MIN_WIDTH }
export const PROCESS_MANAGER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useProcessManagerStore = create<ProcessManagerStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),

  open: () => set({ isOpen: true, isMinimized: false }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((s) => {
      if (s.isMinimized) return { isOpen: true, isMinimized: false }
      if (s.isOpen) return { isOpen: false }
      return { isOpen: true }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
}))

// Re-clamp width on window resize
if (typeof window !== 'undefined') {
  const KEY = '__processManagerStoreResizeAttached'
  if (!(window as unknown as Record<string, unknown>)[KEY]) {
    ;(window as unknown as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useProcessManagerStore.getState()
      const clamped = clampWidth(store.width)
      if (clamped !== store.width) {
        store.setWidth(clamped)
      }
    })
  }
}
