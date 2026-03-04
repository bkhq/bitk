import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import type { Note } from '@/types/kanban'

const notesKeys = {
  all: ['notes'] as const,
}

export function useNotes() {
  return useQuery({
    queryKey: notesKeys.all,
    queryFn: kanbanApi.getNotes,
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { title?: string; content?: string }) =>
      kanbanApi.createNote(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      title?: string
      content?: string
    }) => kanbanApi.updateNote(id, data),
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: notesKeys.all })
      const prev = qc.getQueryData<Note[]>(notesKeys.all)
      if (prev) {
        qc.setQueryData<Note[]>(
          notesKeys.all,
          prev.map((n) => (n.id === id ? { ...n, ...data } : n)),
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(notesKeys.all, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.deleteNote(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notesKeys.all })
      const prev = qc.getQueryData<Note[]>(notesKeys.all)
      if (prev) {
        qc.setQueryData<Note[]>(
          notesKeys.all,
          prev.filter((n) => n.id !== id),
        )
      }
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(notesKeys.all, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}
