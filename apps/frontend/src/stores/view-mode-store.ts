import { create } from 'zustand'

type ViewMode = 'kanban' | 'list'

interface ViewModeStore {
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  projectPath: (projectId: string) => string
}

const STORAGE_KEY = 'bitk-view-mode'

function loadMode(): ViewMode {
  if (typeof window === 'undefined') return 'kanban'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'list') return stored
  return 'kanban'
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
}))
