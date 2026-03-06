import { create } from 'zustand'

type ViewMode = 'kanban' | 'list'

interface ViewModeStore {
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  projectPath: (projectId: string) => string
  fullWidthChat: boolean
  setFullWidthChat: (value: boolean) => void
}

const STORAGE_KEY = 'bitk-view-mode'
const FULL_WIDTH_KEY = 'bitk-full-width-chat'

function loadMode(): ViewMode {
  if (typeof window === 'undefined') return 'kanban'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'list') return stored
  return 'kanban'
}

function loadFullWidth(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(FULL_WIDTH_KEY) === 'true'
}

export const useViewModeStore = create<ViewModeStore>((set, get) => ({
  mode: loadMode(),

  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    set({ mode })
  },

  projectPath: (projectId) => {
    const m = get().mode
    if (m === 'list') return `/projects/${projectId}/issues`
    return `/projects/${projectId}`
  },

  fullWidthChat: loadFullWidth(),

  setFullWidthChat: (value) => {
    localStorage.setItem(FULL_WIDTH_KEY, String(value))
    set({ fullWidthChat: value })
  },
}))
