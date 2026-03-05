import { create } from 'zustand'

const MIN_WIDTH = 520
const DEFAULT_WIDTH_RATIO = 0.38
const MAX_WIDTH_RATIO = 0.6

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function clampWidth(w: number): number {
  const min = MIN_WIDTH
  const max = getViewportWidth() * MAX_WIDTH_RATIO
  return Math.max(min, Math.min(w, max))
}

interface NotesStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  selectedNoteId: string | null
  open: () => void
  openFullscreen: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
  selectNote: (id: string | null) => void
}

export { MIN_WIDTH as NOTES_MIN_WIDTH }
export const NOTES_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useNotesStore = create<NotesStore>((set) => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  selectedNoteId: null,

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
  selectNote: (id) => set({ selectedNoteId: id }),
}))

// Re-clamp width on window resize
if (typeof window !== 'undefined') {
  const KEY = '__notesStoreResizeAttached'
  if (!(window as unknown as Record<string, unknown>)[KEY]) {
    ;(window as unknown as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useNotesStore.getState()
      const clamped = clampWidth(store.width)
      if (clamped !== store.width) {
        store.setWidth(clamped)
      }
    })
  }
}
