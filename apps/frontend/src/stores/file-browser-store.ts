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

interface FileBrowserStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  projectId: string | null
  currentPath: string
  open: (projectId: string) => void
  openFullscreen: (projectId: string) => void
  close: () => void
  toggle: (projectId: string) => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
  navigateTo: (path: string) => void
}

export { MIN_WIDTH as FILE_BROWSER_MIN_WIDTH }
export const FILE_BROWSER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useFileBrowserStore = create<FileBrowserStore>((set) => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  projectId: null,
  currentPath: '.',

  open: (projectId) =>
    set((s) => ({
      isOpen: true,
      isMinimized: false,
      projectId,
      currentPath: s.projectId === projectId ? s.currentPath : '.',
    })),
  openFullscreen: (projectId) =>
    set((s) => ({
      isOpen: true,
      isMinimized: false,
      isFullscreen: true,
      projectId,
      currentPath: s.projectId === projectId ? s.currentPath : '.',
    })),
  close: () => set({ isOpen: false }),
  toggle: (projectId) =>
    set((s) => {
      if (s.isMinimized) {
        return {
          isOpen: true,
          isMinimized: false,
          projectId,
          currentPath: s.projectId === projectId ? s.currentPath : '.',
        }
      }
      if (s.isOpen && s.projectId === projectId) {
        return { isOpen: false }
      }
      return {
        isOpen: true,
        projectId,
        currentPath: s.projectId === projectId ? s.currentPath : '.',
      }
    }),
  minimize: () =>
    set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setWidth: (w) => set({ width: clampWidth(w) }),
  navigateTo: (path) => set({ currentPath: path }),
}))

// Re-clamp width on window resize
if (typeof window !== 'undefined') {
  const KEY = '__fileBrowserStoreResizeAttached'
  if (!(window as Record<string, unknown>)[KEY]) {
    ;(window as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useFileBrowserStore.getState()
      const clamped = clampWidth(store.width)
      if (clamped !== store.width) {
        store.setWidth(clamped)
      }
    })
  }
}
