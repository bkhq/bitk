import {
  ArrowLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/use-mobile'
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/use-notes'
import { cn } from '@/lib/utils'
import { NOTES_MAX_WIDTH_RATIO, NOTES_MIN_WIDTH, useNotesStore } from '@/stores/notes-store'
import type { Note } from '@/types/kanban'

export function NotesDrawer() {
  const { t } = useTranslation()
  const {
    isOpen,
    isFullscreen,
    width,
    selectedNoteId,
    close,
    minimize,
    toggleFullscreen,
    setWidth,
    selectNote,
  } = useNotesStore()
  const isMobile = useIsMobile()
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const { data: notes, isLoading, isError } = useNotes()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const selectedNote = notes?.find(n => n.id === selectedNoteId) ?? null

  const filteredNotes = useMemo(() => {
    if (!notes) return []
    if (!searchQuery.trim()) return notes
    const q = searchQuery.toLowerCase()
    return notes.filter(
      n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    )
  }, [notes, searchQuery])

  const pinnedNotes = useMemo(() => filteredNotes.filter(n => n.isPinned), [filteredNotes])
  const unpinnedNotes = useMemo(() => filteredNotes.filter(n => !n.isPinned), [filteredNotes])

  // Auto-select first note if none selected (desktop only)
  useEffect(() => {
    if (!isMobile && !selectedNoteId && notes && notes.length > 0) {
      selectNote(notes[0].id)
    }
  }, [isMobile, notes, selectedNoteId, selectNote])

  // Clear selection if selected note was deleted
  useEffect(() => {
    if (selectedNoteId && notes && !notes.some(n => n.id === selectedNoteId)) {
      selectNote(isMobile ? null : notes.length > 0 ? notes[0].id : null)
    }
  }, [isMobile, notes, selectedNoteId, selectNote])

  const handleCreate = useCallback(() => {
    createNote.mutate({ title: '', content: '' }, { onSuccess: note => selectNote(note.id) })
  }, [createNote, selectNote])

  const handleDelete = useCallback(
    (id: string) => {
      deleteNote.mutate(id)
    },
    [deleteNote],
  )

  const handlePin = useCallback(
    (id: string, pinned: boolean) => {
      updateNote.mutate({ id, isPinned: pinned })
    },
    [updateNote],
  )

  if (!isOpen) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * NOTES_MAX_WIDTH_RATIO)
  const fullscreen = isMobile || isFullscreen

  // Mobile: if a note is selected, show editor fullscreen
  if (isMobile && selectedNote) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <MobileNoteEditor
          key={selectedNote.id}
          note={selectedNote}
          onUpdate={updateNote.mutate}
          onBack={() => selectNote(null)}
          onDelete={() => handleDelete(selectedNote.id)}
          onPin={() => handlePin(selectedNote.id, !selectedNote.isPinned)}
        />
      </div>
    )
  }

  return (
    <>
      {/* Backdrop overlay — hidden in fullscreen */}
      {fullscreen
        ? null
        : (
            <div aria-hidden="true" className="fixed inset-0 z-[39] bg-black/20" onClick={close} />
          )}
      <div
        className={`fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl ${
          fullscreen ? 'left-0' : ''
        }`}
        style={fullscreen ? undefined : { width }}
      >
        {/* Resize handle — hidden in fullscreen and on mobile */}
        {!fullscreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('notes.resizePanel')}
            aria-valuenow={width}
            aria-valuemin={NOTES_MIN_WIDTH}
            aria-valuemax={maxWidth}
            tabIndex={0}
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
            onKeyDown={(e) => {
              const step = e.shiftKey ? 50 : 10
              if (e.key === 'ArrowLeft') {
                e.preventDefault()
                setWidth(width + step)
              }
              if (e.key === 'ArrowRight') {
                e.preventDefault()
                setWidth(width - step)
              }
            }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground truncate">
              {t('notes.title')}
            </span>
            {notes && notes.length > 0 && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {notes.length}
              </span>
            )}
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
              onClick={minimize}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('notes.minimize')}
              title={t('notes.minimize')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {!isMobile && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t('notes.maximize')}
                title={isFullscreen ? t('notes.restore') : t('notes.maximize')}
              >
                {isFullscreen
                  ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    )
                  : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
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
          <div
            className={cn(
              'shrink-0 border-r border-border flex flex-col',
              isMobile ? 'flex-1' : 'w-56',
            )}
          >
            {/* Search */}
            <div className="px-2 py-1.5 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('notes.searchPlaceholder')}
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading
                ? (
                    <div className="flex items-center justify-center p-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                    </div>
                  )
                : isError
                  ? (
                      <div className="flex flex-col items-center p-6 text-muted-foreground">
                        <TriangleAlert className="h-5 w-5 mb-1 opacity-40" />
                        <p className="text-xs">{t('notes.loadError')}</p>
                      </div>
                    )
                  : filteredNotes.length > 0
                    ? (
                        <>
                          {pinnedNotes.length > 0 && (
                            <>
                              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider px-3 pt-2 pb-0.5">
                                {t('notes.pinned')}
                              </p>
                              {pinnedNotes.map(note => (
                                <NoteListItem
                                  key={note.id}
                                  note={note}
                                  isActive={note.id === selectedNoteId}
                                  onClick={() => selectNote(note.id)}
                                  onDelete={() => handleDelete(note.id)}
                                  onPin={() => handlePin(note.id, false)}
                                />
                              ))}
                            </>
                          )}
                          {unpinnedNotes.length > 0 && (
                            <>
                              {pinnedNotes.length > 0 && (
                                <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider px-3 pt-2 pb-0.5">
                                  {t('notes.other')}
                                </p>
                              )}
                              {unpinnedNotes.map(note => (
                                <NoteListItem
                                  key={note.id}
                                  note={note}
                                  isActive={note.id === selectedNoteId}
                                  onClick={() => selectNote(note.id)}
                                  onDelete={() => handleDelete(note.id)}
                                  onPin={() => handlePin(note.id, true)}
                                />
                              ))}
                            </>
                          )}
                        </>
                      )
                    : (
                        <div className="flex flex-col items-center justify-center p-6 text-muted-foreground">
                          <StickyNote className="h-8 w-8 mb-2 opacity-20" />
                          <p className="text-xs">{t('notes.empty')}</p>
                        </div>
                      )}
            </div>
          </div>

          {/* Editor — hidden on mobile (mobile uses fullscreen editor above) */}
          {!isMobile && (
            <div className="flex-1 min-w-0 flex flex-col">
              {selectedNote
                ? (
                    <NoteEditor
                      key={selectedNote.id}
                      note={selectedNote}
                      onUpdate={updateNote.mutate}
                      onPin={() => handlePin(selectedNote.id, !selectedNote.isPinned)}
                      onDelete={() => handleDelete(selectedNote.id)}
                    />
                  )
                : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                      <StickyNote className="h-8 w-8 opacity-20" />
                      <p className="text-sm">{t('notes.selectOrCreate')}</p>
                    </div>
                  )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Note list item                                                     */
/* ------------------------------------------------------------------ */

function NoteListItem({
  note,
  isActive,
  onClick,
  onDelete,
  onPin,
}: {
  note: Note
  isActive: boolean
  onClick: () => void
  onDelete: () => void
  onPin: () => void
}) {
  const { t } = useTranslation()
  const title = note.title || t('notes.untitled')
  const preview = note.content.slice(0, 80).replace(/\n/g, ' ')

  const lastEdited = useMemo(() => {
    const date = new Date(note.updatedAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays > 0) {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    }
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [note.updatedAt])

  return (
    <div
      className={cn(
        'group mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors',
        isActive ? 'bg-accent' : 'hover:bg-accent/50',
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {note.isPinned && <Pin className="h-2.5 w-2.5 text-primary shrink-0 -rotate-45" />}
            <p className="text-xs font-medium truncate">{title}</p>
          </div>
          {preview && (
            <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{preview}</p>
          )}
          <p className="text-[10px] text-muted-foreground/50 mt-1 tabular-nums">{lastEdited}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
            className={cn(
              'p-0.5 rounded opacity-0 group-hover:opacity-100 transition-all',
              note.isPinned
                ? 'text-primary opacity-100'
                : 'text-muted-foreground hover:text-primary',
            )}
            aria-label={note.isPinned ? t('notes.unpin') : t('notes.pin')}
            title={note.isPinned ? t('notes.unpin') : t('notes.pin')}
          >
            {note.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
          </button>
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
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Desktop note editor                                                */
/* ------------------------------------------------------------------ */

function NoteEditor({
  note,
  onUpdate,
  onPin,
  onDelete,
}: {
  note: Note
  onUpdate: (data: { id: string, title?: string, content?: string }) => void
  onPin: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ title?: string, content?: string } | null>(null)
  const noteIdRef = useRef(note.id)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  noteIdRef.current = note.id

  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.title, note.content])

  const scheduleUpdate = useCallback(
    (data: { title?: string, content?: string }) => {
      pendingRef.current = data
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        pendingRef.current = null
        onUpdate({ id: note.id, ...data })
      }, 800)
    },
    [note.id, onUpdate],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (pendingRef.current) {
        onUpdateRef.current({ id: noteIdRef.current, ...pendingRef.current })
      }
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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0">
        <input
          type="text"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder={t('notes.titlePlaceholder')}
          className="flex-1 text-sm font-medium bg-transparent outline-none placeholder:text-muted-foreground mr-2"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onPin}
            className={cn(
              'p-1.5 rounded hover:bg-accent transition-colors',
              note.isPinned ? 'text-primary' : 'text-muted-foreground hover:text-primary',
            )}
            aria-label={note.isPinned ? t('notes.unpin') : t('notes.pin')}
            title={note.isPinned ? t('notes.unpin') : t('notes.pin')}
          >
            {note.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            aria-label={t('notes.delete')}
            title={t('notes.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <textarea
        value={content}
        onChange={e => handleContentChange(e.target.value)}
        placeholder={t('notes.contentPlaceholder')}
        className="flex-1 px-4 py-3 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground"
      />

      {/* Footer */}
      <div className="flex items-center justify-center px-4 py-1.5 border-t border-border/50 shrink-0">
        <span className="text-[10px] text-muted-foreground/60">
          {t('notes.lastEdited', { time: lastEdited })}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Mobile note editor (fullscreen)                                    */
/* ------------------------------------------------------------------ */

function MobileNoteEditor({
  note,
  onUpdate,
  onBack,
  onDelete,
  onPin,
}: {
  note: Note
  onUpdate: (data: { id: string, title?: string, content?: string }) => void
  onBack: () => void
  onDelete: () => void
  onPin: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ title?: string, content?: string } | null>(null)
  const noteIdRef = useRef(note.id)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  noteIdRef.current = note.id

  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.title, note.content])

  const scheduleUpdate = useCallback(
    (data: { title?: string, content?: string }) => {
      pendingRef.current = data
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        pendingRef.current = null
        onUpdate({ id: note.id, ...data })
      }, 800)
    },
    [note.id, onUpdate],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (pendingRef.current) {
        onUpdateRef.current({ id: noteIdRef.current, ...pendingRef.current })
      }
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
      <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-full text-foreground hover:bg-accent transition-colors"
          aria-label={t('notes.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPin}
            className={cn(
              'p-2 rounded-full hover:bg-accent transition-colors',
              note.isPinned ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label={note.isPinned ? t('notes.unpin') : t('notes.pin')}
          >
            {note.isPinned ? <PinOff className="h-4.5 w-4.5" /> : <Pin className="h-4.5 w-4.5" />}
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
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4">
        <input
          type="text"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder={t('notes.titlePlaceholder')}
          className="text-xl font-medium bg-transparent outline-none placeholder:text-muted-foreground py-2"
        />
        <textarea
          value={content}
          onChange={e => handleContentChange(e.target.value)}
          placeholder={t('notes.contentPlaceholder')}
          className="flex-1 text-sm bg-transparent outline-none resize-none placeholder:text-muted-foreground min-h-[200px]"
        />
      </div>

      <div className="flex items-center justify-center px-4 py-3 border-t border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {t('notes.lastEdited', { time: lastEdited })}
        </span>
      </div>
    </>
  )
}
