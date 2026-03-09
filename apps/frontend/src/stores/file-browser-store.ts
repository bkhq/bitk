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

/** Build a cache key for per-context path persistence. */
function contextKey(projectId: string, rootPath: string | null): string {
  return rootPath ? `${projectId}:${rootPath}` : projectId
}

interface FileBrowserStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  /** When true, an inline panel handles rendering (suppresses the global drawer) */
  inlineMode: boolean
  /** When true, force drawer rendering even if inlineMode is on */
  forceDrawer: boolean
  width: number
  projectId: string | null
  rootPath: string | null
  currentPath: string
  hideIgnored: boolean
  /** Per-context path cache so switching contexts restores the last position. */
  pathCache: Map<string, string>
  open: (projectId: string, rootPath?: string) => void
  openFullscreen: (projectId: string, rootPath?: string) => void
  close: () => void
  toggle: (projectId: string) => void
  /** Toggle as drawer, overriding inlineMode so the global drawer renders. */
  toggleDrawer: (projectId: string, rootPath?: string) => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
  setInlineMode: (inline: boolean) => void
  navigateTo: (path: string) => void
  toggleHideIgnored: () => void
}

export { MIN_WIDTH as FILE_BROWSER_MIN_WIDTH }
export const FILE_BROWSER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

/**
 * Save current path to cache and resolve the path for a new context.
 * Returns the cached path or '.' if the context is new.
 */
function switchContext(
  s: FileBrowserStore,
  projectId: string,
  rootPath: string | null,
): { currentPath: string, pathCache: Map<string, string> } {
  const newKey = contextKey(projectId, rootPath)
  const oldKey = s.projectId ? contextKey(s.projectId, s.rootPath) : null

  // Same context — keep current path, no cache update needed
  if (oldKey === newKey) {
    return { currentPath: s.currentPath, pathCache: s.pathCache }
  }

  // Save current path for the old context
  const cache = new Map(s.pathCache)
  if (oldKey) cache.set(oldKey, s.currentPath)

  // Restore cached path for the new context
  return { currentPath: cache.get(newKey) ?? '.', pathCache: cache }
}

export const useFileBrowserStore = create<FileBrowserStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  inlineMode: false,
  forceDrawer: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  projectId: null,
  rootPath: null,
  currentPath: '.',
  hideIgnored: false,
  pathCache: new Map(),

  open: (projectId, rootPath) =>
    set((s) => {
      const ctx = switchContext(s, projectId, rootPath ?? null)
      return {
        isOpen: true,
        isMinimized: false,
        projectId,
        rootPath: rootPath ?? null,
        ...ctx,
      }
    }),
  openFullscreen: (projectId, rootPath) =>
    set((s) => {
      const ctx = switchContext(s, projectId, rootPath ?? null)
      return {
        isOpen: true,
        isMinimized: false,
        isFullscreen: true,
        projectId,
        rootPath: rootPath ?? null,
        ...ctx,
      }
    }),
  close: () => set({ isOpen: false, forceDrawer: false }),
  toggle: projectId =>
    set((s) => {
      if (s.isMinimized) {
        const ctx = switchContext(s, projectId, s.projectId === projectId ? s.rootPath : null)
        return {
          isOpen: true,
          isMinimized: false,
          projectId,
          rootPath: s.projectId === projectId ? s.rootPath : null,
          ...ctx,
        }
      }
      if (s.isOpen && s.projectId === projectId) {
        return { isOpen: false }
      }
      const newRoot = s.projectId === projectId ? s.rootPath : null
      const ctx = switchContext(s, projectId, newRoot)
      return {
        isOpen: true,
        projectId,
        rootPath: newRoot,
        ...ctx,
      }
    }),
  toggleDrawer: (projectId, rootPath) =>
    set((s) => {
      if (s.isOpen && s.forceDrawer && s.projectId === projectId) {
        return { isOpen: false, forceDrawer: false }
      }
      const effectiveRoot = rootPath ?? (s.projectId === projectId ? s.rootPath : null)
      const ctx = switchContext(s, projectId, effectiveRoot)
      return {
        isOpen: true,
        isMinimized: false,
        forceDrawer: true,
        projectId,
        rootPath: effectiveRoot,
        ...ctx,
      }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
  setInlineMode: inline => set({ inlineMode: inline }),
  navigateTo: path => set({ currentPath: path }),
  toggleHideIgnored: () => set(s => ({ hideIgnored: !s.hideIgnored })),
}))

// Re-clamp width on window resize
if (typeof window !== 'undefined') {
  const KEY = '__fileBrowserStoreResizeAttached'
  if (!(window as unknown as Record<string, unknown>)[KEY]) {
    ;(window as unknown as Record<string, unknown>)[KEY] = true
    window.addEventListener('resize', () => {
      const store = useFileBrowserStore.getState()
      const clamped = clampWidth(store.width)
      if (clamped !== store.width) {
        store.setWidth(clamped)
      }
    })
  }
}
