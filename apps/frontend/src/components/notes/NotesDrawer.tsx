import { ArrowLeft, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
} from '@/hooks/use-notes'
import { cn } from '@/lib/utils'
import { useNotesStore } from '@/stores/notes-store'
import type { Note } from '@/types/kanban'

const MIN_WIDTH = 400
const DEFAULT_WIDTH_RATIO = 0.35
const MAX_WIDTH_RATIO = 0.6

function clampWidth(w: number): number {
  const max =
    (typeof window === 'undefined' ? 1024 : window.innerWidth) * MAX_WIDTH_RATIO
  return Math.max(MIN_WIDTH, Math.min(w, max))
}

export function NotesDrawer() {
  const isMobile = useIsMobile()

  if (isMobile) return <MobileNotesDrawer />
  return <DesktopNotesDrawer />
}

/* ------------------------------------------------------------------ */
/*  Mobile — Google Keep style: list view ↔ editor view               */
/* ------------------------------------------------------------------ */

function MobileNotesDrawer() {
  const { t } = useTranslation()
  const { isOpen, selectedNoteId, close, selectNote } = useNotesStore()
  const [searchQuery, setSearchQuery] = useState('')

  const { data: notes } = useNotes()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const selectedNote = notes?.find((n) => n.id === selectedNoteId) ?? null

  // Clear selection if selected note was deleted
  useEffect(() => {
    if (
      selectedNoteId &&
      notes &&
      !notes.find((n) => n.id === selectedNoteId)
    ) {
      selectNote(null)
    }
  }, [notes, selectedNoteId, selectNote])

  const filteredNotes = useMemo(() => {
    if (!notes) return []
    if (!searchQuery.trim()) return notes
    const q = searchQuery.toLowerCase()
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    )
  }, [notes, searchQuery])

  const handleCreate = useCallback(() => {
    createNote.mutate(
      { title: '', content: '' },
      { onSuccess: (note) => selectNote(note.id) },
    )
  }, [createNote, selectNote])

  const handleDelete = useCallback(
    (id: string) => {
      deleteNote.mutate(id)
    },
    [deleteNote],
  )

  const handleBack = useCallback(() => {
    selectNote(null)
  }, [selectNote])

  if (!isOpen) return null

  // Editor view — full screen when a note is selected
  if (selectedNote) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <MobileNoteEditor
          note={selectedNote}
          onUpdate={updateNote.mutate}
          onBack={handleBack}
          onDelete={() => handleDelete(selectedNote.id)}
        />
      </div>
    )
  }

  // List view
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 rounded-full bg-muted/60 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('notes.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={close}
            className="p-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('notes.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Note cards */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filteredNotes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {filteredNotes.map((note) => (
              <MobileNoteCard
                key={note.id}
                note={note}
                onClick={() => selectNote(note.id)}
                onDelete={() => handleDelete(note.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <StickyNote className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">{t('notes.empty')}</p>
          </div>
        )}
      </div>

      {/* FAB — create new note */}
      <button
        type="button"
        onClick={handleCreate}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xl active:scale-95 transition-transform"
        aria-label={t('notes.create')}
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  )
}

function MobileNoteCard({
  note,
  onClick,
  onDelete,
}: {
  note: Note
  onClick: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const title = note.title || t('notes.untitled')
  const preview = note.content.slice(0, 120).replace(/\n/g, ' ')

  return (
    <div
      className="group rounded-xl border border-border bg-card p-3.5 active:bg-accent/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{title}</p>
          {preview && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {preview}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded-md text-muted-foreground/50 hover:text-destructive transition-colors shrink-0"
          aria-label={t('notes.delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function MobileNoteEditor({
  note,
  onUpdate,
  onBack,
  onDelete,
}: {
  note: Note
  onUpdate: (data: { id: string; title?: string; content?: string }) => void
  onBack: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.title, note.content])

  const scheduleUpdate = useCallback(
    (data: { title?: string; content?: string }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onUpdate({ id: note.id, ...data })
      }, 800)
    },
    [note.id, onUpdate],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value)
      scheduleUpdate({ title: value, content })
    },
    [content, scheduleUpdate],
  )

  const handleContentChange = useCallback(
    (value: string) => {
      setContent(value)
      scheduleUpdate({ title, content: value })
    },
    [title, scheduleUpdate],
  )

  const lastEdited = useMemo(() => {
    const date = new Date(note.updatedAt)
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [note.updatedAt])

  return (
    <>
      {/* Top bar */}
      <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-full text-foreground hover:bg-accent transition-colors"
          aria-label={t('notes.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-2 rounded-full text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
          aria-label={t('notes.delete')}
        >
          <Trash2 className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* Title + Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t('notes.titlePlaceholder')}
          className="text-xl font-medium bg-transparent outline-none placeholder:text-muted-foreground py-2"
        />
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder={t('notes.contentPlaceholder')}
          className="flex-1 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground min-h-[200px]"
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-center px-4 py-3 border-t border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {t('notes.lastEdited', { time: lastEdited })}
        </span>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Desktop — side panel with list + editor (original design)         */
/* ------------------------------------------------------------------ */

function DesktopNotesDrawer() {
  const { t } = useTranslation()
  const { isOpen, selectedNoteId, close, selectNote } = useNotesStore()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const [width, setWidthRaw] = useState(() =>
    Math.round(
      (typeof window === 'undefined' ? 1024 : window.innerWidth) *
        DEFAULT_WIDTH_RATIO,
    ),
  )
  const setWidth = useCallback((w: number) => setWidthRaw(clampWidth(w)), [])

  const { data: notes } = useNotes()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const selectedNote = notes?.find((n) => n.id === selectedNoteId) ?? null

  // Auto-select first note if none selected
  useEffect(() => {
    if (!selectedNoteId && notes && notes.length > 0) {
      selectNote(notes[0].id)
    }
  }, [notes, selectedNoteId, selectNote])

  // Clear selection if selected note was deleted
  useEffect(() => {
    if (
      selectedNoteId &&
      notes &&
      !notes.find((n) => n.id === selectedNoteId)
    ) {
      selectNote(notes.length > 0 ? notes[0].id : null)
    }
  }, [notes, selectedNoteId, selectNote])

  const handleCreate = useCallback(() => {
    createNote.mutate(
      { title: '', content: '' },
      { onSuccess: (note) => selectNote(note.id) },
    )
  }, [createNote, selectNote])

  const handleDelete = useCallback(
    (id: string) => {
      deleteNote.mutate(id)
    },
    [deleteNote],
  )

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[39] bg-black/20"
        onClick={close}
      />
      <div
        className="fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl"
        style={{ width }}
      >
        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('notes.resizePanel')}
          className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2 z-10 cursor-col-resize group select-none outline-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { startX: e.clientX, startWidth: width }
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return
            const dx = dragRef.current.startX - e.clientX
            setWidth(dragRef.current.startWidth + dx)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground truncate">
              {t('notes.title')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCreate}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('notes.create')}
              title={t('notes.create')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={close}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('notes.close')}
              title={t('notes.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Note list */}
          <div className="w-48 shrink-0 border-r border-border overflow-y-auto">
            {notes && notes.length > 0 ? (
              notes.map((note) => (
                <DesktopNoteListItem
                  key={note.id}
                  note={note}
                  isActive={note.id === selectedNoteId}
                  onClick={() => selectNote(note.id)}
                  onDelete={() => handleDelete(note.id)}
                />
              ))
            ) : (
              <div className="p-3 text-xs text-muted-foreground text-center">
                {t('notes.empty')}
              </div>
            )}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedNote ? (
              <DesktopNoteEditor
                note={selectedNote}
                onUpdate={updateNote.mutate}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                {t('notes.selectOrCreate')}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function DesktopNoteListItem({
  note,
  isActive,
  onClick,
  onDelete,
}: {
  note: Note
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const title = note.title || t('notes.untitled')
  const preview = note.content.slice(0, 60).replace(/\n/g, ' ')

  return (
    <div
      className={cn(
        'group px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-accent/50 transition-colors',
        isActive && 'bg-accent',
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{title}</p>
          {preview && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {preview}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
          aria-label={t('notes.delete')}
          title={t('notes.delete')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function DesktopNoteEditor({
  note,
  onUpdate,
}: {
  note: Note
  onUpdate: (data: { id: string; title?: string; content?: string }) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync state when switching notes
  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.title, note.content])

  const scheduleUpdate = useCallback(
    (data: { title?: string; content?: string }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onUpdate({ id: note.id, ...data })
      }, 800)
    },
    [note.id, onUpdate],
  )

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value)
      scheduleUpdate({ title: value, content })
    },
    [content, scheduleUpdate],
  )

  const handleContentChange = useCallback(
    (value: string) => {
      setContent(value)
      scheduleUpdate({ title, content: value })
    },
    [title, scheduleUpdate],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <input
        type="text"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder={t('notes.titlePlaceholder')}
        className="px-4 py-2 text-sm font-medium border-b border-border bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder={t('notes.contentPlaceholder')}
        className="flex-1 px-4 py-3 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
