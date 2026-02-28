import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  SlashSquare,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EngineIcon } from '@/components/EngineIcons'
import { formatFileSize, formatModelName } from '@/lib/format'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useChangesSummary } from '@/hooks/use-changes-summary'
import { useEngineAvailability, useFollowUpIssue } from '@/hooks/use-kanban'
import type { BusyAction, EngineModel, SessionStatus } from '@/types/kanban'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_FILES = 10

const MODE_OPTIONS = ['auto', 'ask'] as const
type ModeOption = (typeof MODE_OPTIONS)[number]

function normalizePrompt(input: string): string {
  return input.replace(/^(?:\\n|\s)+/g, '').replace(/(?:\\n|\s)+$/g, '')
}

function toPermissionMode(mode: ModeOption): 'auto' | 'supervised' {
  if (mode === 'ask') return 'supervised'
  return mode
}

export function ChatInput({
  projectId,
  issueId,
  diffOpen,
  onToggleDiff,
  scrollRef,
  engineType,
  model,
  sessionStatus,
  statusId,
  isThinking = false,
  onMessageSent,
  slashCommands = [],
}: {
  projectId?: string
  issueId?: string
  diffOpen?: boolean
  onToggleDiff?: () => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
  engineType?: string
  model?: string
  sessionStatus?: SessionStatus | null
  statusId?: string
  isThinking?: boolean
  onMessageSent?: (
    messageId: string,
    prompt: string,
    metadata?: Record<string, unknown>,
  ) => void
  slashCommands?: string[]
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isSendingRef = useRef(false)

  const followUp = useFollowUpIssue(projectId ?? '')
  const changesSummary = useChangesSummary(projectId, issueId ?? undefined)
  const changedCount = changesSummary?.fileCount ?? 0
  const additions = changesSummary?.additions ?? 0
  const deletions = changesSummary?.deletions ?? 0

  // Fetch models for current engine
  const { data: discovery } = useEngineAvailability(!!engineType)
  const models = useMemo(
    () => (engineType ? (discovery?.models[engineType] ?? []) : []),
    [engineType, discovery],
  )
  const [selectedModel, setSelectedModel] = useState(model || '')
  // Sync selectedModel when issue changes (model prop changes)
  useEffect(() => {
    setSelectedModel(model || '')
  }, [model])
  const [mode, setMode] = useState<ModeOption>('auto')
  const [busyAction, setBusyAction] = useState<BusyAction>('queue')
  const activeModel = selectedModel || model || ''
  const isSessionActive =
    sessionStatus === 'running' || sessionStatus === 'pending'
  const effectiveBusyAction: BusyAction | undefined = isSessionActive
    ? isThinking
      ? 'queue'
      : busyAction
    : undefined

  // Command picker
  const [cmdPickerOpen, setCmdPickerOpen] = useState(false)
  const [cmdPickerSearch, setCmdPickerSearch] = useState('')
  const cmdPickerRef = useRef<HTMLDivElement>(null)
  const cmdSearchRef = useRef<HTMLInputElement>(null)
  useClickOutside(cmdPickerRef, cmdPickerOpen, () => setCmdPickerOpen(false))

  // Commands from SDK may or may not have "/" prefix — normalize
  const normalizedCommands = useMemo(
    () => slashCommands.map((cmd) => (cmd.startsWith('/') ? cmd : `/${cmd}`)),
    [slashCommands],
  )

  const filteredPickerCommands = useMemo(() => {
    if (!cmdPickerOpen) return []
    if (!cmdPickerSearch.trim()) return normalizedCommands
    const q = cmdPickerSearch.toLowerCase()
    return normalizedCommands.filter((cmd) => cmd.toLowerCase().includes(q))
  }, [cmdPickerOpen, cmdPickerSearch, normalizedCommands])

  const normalizedPrompt = normalizePrompt(input)
  const canSend =
    (normalizedPrompt.length > 0 || attachedFiles.length > 0) &&
    !!issueId &&
    !!projectId

  const addFiles = useCallback(
    (incoming: File[]) => {
      setAttachedFiles((prev) => {
        const combined = [...prev]
        for (const file of incoming) {
          if (file.size > MAX_FILE_SIZE) {
            setSendError(
              t('chat.fileTooBig', {
                name: file.name,
                limit: MAX_FILE_SIZE / 1024 / 1024,
              }),
            )
            setTimeout(() => setSendError(null), 5000)
            continue
          }
          if (combined.length >= MAX_FILES) {
            setSendError(t('chat.tooManyFiles', { max: MAX_FILES }))
            setTimeout(() => setSendError(null), 5000)
            break
          }
          // Deduplicate by name+size
          if (
            !combined.some((f) => f.name === file.name && f.size === file.size)
          ) {
            combined.push(file)
          }
        }
        return combined
      })
    },
    [t],
  )

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const removed = prev[index]
      // Clear preview if the removed file is currently being previewed
      setPreviewFile((current) =>
        current &&
        current.name === removed.name &&
        current.size === removed.size
          ? null
          : current,
      )
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleSend = async () => {
    if (!canSend || !issueId || isSendingRef.current) return
    isSendingRef.current = true
    const prompt = normalizedPrompt
    const filesToSend = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setSendError(null)
    try {
      const isTodo = statusId === 'todo'
      const isDone = statusId === 'done'
      const isWorking = statusId === 'working'
      const result = await followUp.mutateAsync({
        issueId,
        prompt,
        model: activeModel || undefined,
        permissionMode: toPermissionMode(mode),
        busyAction: effectiveBusyAction,
        files: filesToSend.length > 0 ? filesToSend : undefined,
      })
      // Append message with server-assigned messageId
      if (result.messageId) {
        const filesMeta =
          filesToSend.length > 0
            ? filesToSend.map((f) => ({
                id: '',
                name: f.name,
                mimeType: f.type,
                size: f.size,
              }))
            : undefined
        const isCommand = prompt.startsWith('/')
        const metadata: Record<string, unknown> | undefined = isTodo
          ? {
              type: 'pending',
              ...(filesMeta ? { attachments: filesMeta } : {}),
            }
          : isDone
            ? { type: 'done', ...(filesMeta ? { attachments: filesMeta } : {}) }
            : isWorking && isThinking
              ? {
                  type: 'pending',
                  ...(filesMeta ? { attachments: filesMeta } : {}),
                }
              : isCommand
                ? { type: 'command' }
                : filesMeta
                  ? { attachments: filesMeta }
                  : undefined
        onMessageSent?.(result.messageId, prompt, metadata)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSendError(msg)
      // Restore files on failure
      setAttachedFiles(filesToSend)
      setTimeout(() => setSendError(null), 5000)
    } finally {
      isSendingRef.current = false
    }
  }

  const selectSlashCommand = useCallback((cmd: string) => {
    setInput(cmd)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.focus()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value
      setInput(val)
      const el = e.target
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    },
    [],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) addFiles(files)
    },
    [addFiles],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addFiles(files)
      // Reset input so same file can be re-selected
      e.target.value = ''
    },
    [addFiles],
  )

  return (
    <div className="shrink-0 w-full min-w-0 px-4 pb-4 relative z-30">
      <div
        className={`rounded-xl border bg-card/80 backdrop-blur-sm shadow-sm transition-all duration-200 focus-within:border-border focus-within:shadow-md ${
          isDragOver
            ? 'border-primary/50 bg-primary/[0.03] ring-2 ring-primary/20'
            : 'border-border/60'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay hint */}
        {isDragOver ? (
          <div className="flex items-center justify-center py-4 text-xs text-primary font-medium">
            {t('chat.attachDragHint')}
          </div>
        ) : null}

        {/* Status bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
          <button
            type="button"
            onClick={onToggleDiff}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all duration-200 ${
              diffOpen
                ? 'bg-primary/[0.08] ring-1 ring-primary/20 text-foreground'
                : 'bg-muted/40 hover:bg-muted/60 text-muted-foreground'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span>{t('chat.filesChanged', { count: changedCount })}</span>
              <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                +{additions}
              </span>
              <span className="font-mono tabular-nums text-red-600 dark:text-red-400 font-medium">
                -{deletions}
              </span>
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1">
            {isSessionActive && !isThinking ? (
              <BusyActionSelect value={busyAction} onChange={setBusyAction} />
            ) : null}
            <ModeSelect value={mode} onChange={setMode} />
            {models.length > 0 ? (
              <ModelSelect
                models={models}
                value={activeModel}
                onChange={setSelectedModel}
              />
            ) : null}
          </div>
        </div>

        {/* Error banner */}
        {sendError ? (
          <div className="mx-3 mt-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
            {sendError}
          </div>
        ) : null}

        {/* Textarea */}
        <div className="px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              // Scroll chat to bottom when keyboard opens on mobile
              setTimeout(() => {
                scrollRef?.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: 'smooth',
                })
              }, 100)
            }}
            placeholder={
              statusId === 'todo'
                ? t('chat.placeholderTodo')
                : t('chat.placeholder')
            }
            rows={1}
            className="w-full bg-transparent text-base md:text-sm resize-none outline-none placeholder:text-muted-foreground/40 min-h-[24px] leading-relaxed"
          />
        </div>

        {/* File preview bar — below textarea */}
        {attachedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
            {attachedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${file.size}`}
                className="group/file flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border/40 px-2 py-1 text-xs cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={() => setPreviewFile(file)}
              >
                {file.type.startsWith('image/') ? (
                  <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate max-w-[120px]">{file.name}</span>
                <span className="text-muted-foreground/60">
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFile(idx)
                  }}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title={t('chat.removeFile')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-2.5 pb-2.5 pt-0.5">
          <div className="flex items-center gap-0.5">
            {engineType ? <EngineInfo engineType={engineType} /> : null}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title={t('chat.attach')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            {normalizedCommands.length > 0 ? (
              <CommandPicker
                commands={filteredPickerCommands}
                open={cmdPickerOpen}
                search={cmdPickerSearch}
                onSearchChange={setCmdPickerSearch}
                onToggle={() => {
                  setCmdPickerOpen((v) => !v)
                  setCmdPickerSearch('')
                  setTimeout(() => cmdSearchRef.current?.focus(), 0)
                }}
                onSelect={(cmd) => {
                  selectSlashCommand(cmd)
                  setCmdPickerOpen(false)
                  setCmdPickerSearch('')
                }}
                pickerRef={cmdPickerRef}
                searchRef={cmdSearchRef}
              />
            ) : null}
          </div>

          <button
            type="button"
            disabled={!canSend || followUp.isPending}
            onClick={handleSend}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-semibold text-background transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {followUp.isPending ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('session.sending')}
              </span>
            ) : (
              t('chat.send')
            )}
          </button>
        </div>
      </div>

      {/* File preview modal */}
      {previewFile ? (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
    </div>
  )
}

function FilePreviewModal({
  file,
  onClose,
}: {
  file: File
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setImageUrl(null)
  }, [file])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative mx-4 max-h-[80vh] max-w-[90vw] md:max-w-[600px] rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2 min-w-0">
            {file.type.startsWith('image/') ? (
              <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="text-sm font-medium truncate">{file.name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={t('chat.closePreview')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-auto max-h-[calc(80vh-56px)]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={file.name}
              className="max-w-full max-h-[60vh] rounded-lg object-contain mx-auto"
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-muted/60 mx-auto">
                <FileText className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {file.type || t('chat.unknownType')} &middot;{' '}
                  {formatFileSize(file.size)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BusyActionSelect({
  value,
  onChange,
}: {
  value: BusyAction
  onChange: (v: BusyAction) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title={t('chat.busyAction.label')}
      >
        <span className="truncate max-w-[100px]">
          {t(`chat.busyAction.${value}`)}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open ? (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 min-w-[150px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-1 shadow-xl text-xs text-popover-foreground">
          {(['queue', 'cancel'] as const).map((option) => {
            const isActive = option === value
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent/50'
                }`}
              >
                <span className="truncate">
                  {t(`chat.busyAction.${option}`)}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function EngineInfo({ engineType }: { engineType: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const engineName = t(`createIssue.engineLabel.${engineType}`, engineType)

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={engineName}
      >
        <EngineIcon engineType={engineType} className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 whitespace-nowrap rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs text-popover-foreground">
          <div className="flex items-center gap-1.5">
            <EngineIcon engineType={engineType} className="h-3 w-3 shrink-0" />
            <span className="font-medium">{engineName}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: EngineModel[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const current = models.find((m) => m.id === value)
  const displayName = current
    ? formatModelName(current.name || current.id)
    : formatModelName(value)

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <span className="truncate max-w-[140px]">{displayName}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open ? (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 min-w-[180px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-1 shadow-xl text-xs text-popover-foreground">
          {models.map((m) => {
            const isActive = m.id === value
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent/50'
                }`}
              >
                <span className="truncate">
                  {formatModelName(m.name || m.id)}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function CommandPicker({
  commands,
  open,
  search,
  onSearchChange,
  onToggle,
  onSelect,
  pickerRef,
  searchRef,
}: {
  commands: string[]
  open: boolean
  search: string
  onSearchChange: (v: string) => void
  onToggle: () => void
  onSelect: (cmd: string) => void
  pickerRef: React.RefObject<HTMLDivElement | null>
  searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const { t } = useTranslation()

  return (
    <div ref={pickerRef} className="relative flex">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={t('chat.commands')}
      >
        <SlashSquare className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 w-[260px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm shadow-xl text-xs text-popover-foreground">
          <div className="px-2 pt-2 pb-1">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onToggle()
                }
              }}
              placeholder={t('chat.commandSearch')}
              className="w-full rounded-md border border-border/40 bg-background/80 px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/40 focus:border-border"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {commands.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground/50">
                {t('chat.noCommands')}
              </div>
            ) : (
              commands.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => onSelect(cmd)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors hover:bg-accent/50"
                >
                  <code className="font-mono text-xs text-foreground/80">
                    {cmd}
                  </code>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ModeSelect({
  value,
  onChange,
}: {
  value: ModeOption
  onChange: (v: ModeOption) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title={t('createIssue.mode')}
      >
        <span className="truncate max-w-[84px]">
          {t(`createIssue.perm.${value}`)}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open ? (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 min-w-[130px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-1 shadow-xl text-xs text-popover-foreground">
          {MODE_OPTIONS.map((option) => {
            const isActive = option === value
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent/50'
                }`}
              >
                <span className="truncate">
                  {t(`createIssue.perm.${option}`)}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
