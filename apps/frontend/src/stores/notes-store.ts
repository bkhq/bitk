import { create } from 'zustand'

interface NotesStore {
  isOpen: boolean
  selectedNoteId: string | null
  open: () => void
  close: () => void
  toggle: () => void
  selectNote: (id: string | null) => void
}

export const useNotesStore = create<NotesStore>((set) => ({
  isOpen: false,
  selectedNoteId: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  selectNote: (id) => set({ selectedNoteId: id }),
}))
