import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  SlashSquare,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EngineIcon } from '@/components/EngineIcons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useChangesSummary } from '@/hooks/use-changes-summary'
import { useEngineAvailability, useFollowUpIssue } from '@/hooks/use-kanban'
import { formatFileSize, formatModelName } from '@/lib/format'
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

  // Commands from SDK may or may not have "/" prefix — normalize
  const normalizedCommands = useMemo(
    () => slashCommands.map((cmd) => (cmd.startsWith('/') ? cmd : `/${cmd}`)),
    [slashCommands],
  )

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
      void handleSend()
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
    <div className="shrink-0 w-full min-w-0 p-4 relative z-30">
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

        {/* Textarea — shadcn Textarea, style overrides to match original */}
        <div className="px-3 py-2.5">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
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
            className="w-full bg-transparent text-base md:text-sm resize-none outline-none border-none shadow-none placeholder:text-muted-foreground/40 leading-relaxed focus-visible:ring-0"
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
            <Button
              variant="ghost"
              size="icon"
              title={t('chat.attach')}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            {normalizedCommands.length > 0 ? (
              <CommandPicker
                commands={normalizedCommands}
                onSelect={(cmd) => selectSlashCommand(cmd)}
              />
            ) : null}
          </div>

          <Button
            type="button"
            disabled={!canSend || followUp.isPending}
            onClick={handleSend}
          >
            {followUp.isPending ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                {t('session.sending')}
              </span>
            ) : (
              t('chat.send')
            )}
          </Button>
        </div>
      </div>

      {/* File preview modal — shadcn Dialog */}
      {previewFile ? (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
    </div>
  )
}

// ─── FilePreviewModal ────────────────────────────────────────────────────────
// Replaced custom modal with shadcn Dialog

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
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setImageUrl(null)
  }, [file])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border/30 space-y-0">
          {file.type.startsWith('image/') ? (
            <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <DialogTitle className="text-sm font-medium truncate">
            {file.name}
          </DialogTitle>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  )
}

// ─── BusyActionSelect ────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function BusyActionSelect({
  value,
  onChange,
}: {
  value: BusyAction
  onChange: (v: BusyAction) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground gap-1"
          title={t('chat.busyAction.label')}
        >
          <span className="truncate max-w-[100px]">
            {t(`chat.busyAction.${value}`)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="min-w-[150px] text-xs"
      >
        {(['queue', 'cancel'] as const).map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className={
              option === value ? 'bg-primary/10 text-primary font-medium' : ''
            }
          >
            {t(`chat.busyAction.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── EngineInfo ──────────────────────────────────────────────────────────────
// Replaced custom popover with shadcn Popover

function EngineInfo({ engineType }: { engineType: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const engineName = t(`createIssue.engineLabel.${engineType}`, engineType)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={engineName}>
          <EngineIcon engineType={engineType} className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-auto px-3 py-2 text-xs"
      >
        <div className="flex items-center gap-1.5">
          <EngineIcon engineType={engineType} className="h-3 w-3 shrink-0" />
          <span className="font-medium">{engineName}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── ModelSelect ─────────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: EngineModel[]
  value: string
  onChange: (v: string) => void
}) {
  const current = models.find((m) => m.id === value)
  const displayName = current
    ? formatModelName(current.name || current.id)
    : formatModelName(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground gap-1"
        >
          <span className="truncate max-w-[140px]">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="min-w-[180px] text-xs"
      >
        {models.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange(m.id)}
            className={
              m.id === value ? 'bg-primary/10 text-primary font-medium' : ''
            }
          >
            {formatModelName(m.name || m.id)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── CommandPicker ────────────────────────────────────────────────────────────
// Replaced custom popover + search with shadcn Popover + Command

function CommandPicker({
  commands,
  onSelect,
}: {
  commands: string[]
  onSelect: (cmd: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={t('chat.commands')}>
          <SlashSquare className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[260px] p-0">
        <Command>
          <CommandInput
            placeholder={t('chat.commandSearch')}
            className="text-xs h-8"
          />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="text-xs text-muted-foreground/50 px-3 py-2">
              {t('chat.noCommands')}
            </CommandEmpty>
            {commands.map((cmd) => (
              <CommandItem
                key={cmd}
                value={cmd}
                onSelect={() => {
                  onSelect(cmd)
                  setOpen(false)
                }}
                className="text-xs px-3 py-1.5"
              >
                <code className="font-mono text-foreground/80">{cmd}</code>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── ModeSelect ───────────────────────────────────────────────────────────────
// Replaced custom dropdown with shadcn DropdownMenu

function ModeSelect({
  value,
  onChange,
}: {
  value: ModeOption
  onChange: (v: ModeOption) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground gap-1"
          title={t('createIssue.mode')}
        >
          <span className="truncate max-w-[84px]">
            {t(`createIssue.perm.${value}`)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="min-w-[130px] text-xs"
      >
        {MODE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onChange(option)}
            className={
              option === value ? 'bg-primary/10 text-primary font-medium' : ''
            }
          >
            {t(`createIssue.perm.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
