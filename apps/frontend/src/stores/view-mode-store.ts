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
  return stored === 'list' ? 'list' : 'kanban'
}

export const useViewModeStore = create<ViewModeStore>((set, get) => ({
  mode: loadMode(),

  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    set({ mode })
  },

  projectPath: (projectId) =>
    get().mode === 'list'
      ? `/projects/${projectId}/issues`
      : `/projects/${projectId}`,
}))
