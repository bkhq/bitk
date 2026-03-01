import {
  ChevronDown,
  ChevronsRight,
  GitBranch,
  MousePointerClick,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EngineIcon } from '@/components/EngineIcons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateIssue,
  useEngineAvailability,
  useEngineProfiles,
  useEngineSettings,
} from '@/hooks/use-kanban'
import { tPriority, tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition } from '@/lib/statuses'
import { STATUSES } from '@/lib/statuses'
import { usePanelStore } from '@/stores/panel-store'
import type {
  EngineAvailability,
  EngineModel,
  EngineProfile,
  Priority,
} from '@/types/kanban'
import { PriorityIcon } from './PriorityIcon'

// ── Data ──────────────────────────────────────────────

const PERMISSIONS = [
  { id: 'auto', icon: ChevronsRight },
  { id: 'ask', icon: MousePointerClick },
] as const
type PermissionId = (typeof PERMISSIONS)[number]['id']

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low']

// ── Shared form body ─────────────────────────────────

export function CreateIssueForm({
  projectId,
  initialStatusId,
  parentIssueId,
  autoFocus,
  onCreated,
  onCancel,
}: {
  projectId: string
  initialStatusId?: string
  parentIssueId?: string
  autoFocus?: boolean
  onCreated?: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const createIssue = useCreateIssue(projectId)

  // Engine discovery data
  const { data: discovery } = useEngineAvailability(true)
  const { data: profiles } = useEngineProfiles(true)
  const { data: engineSettings } = useEngineSettings(true)

  const installedEngines = useMemo(
    () =>
      discovery?.engines.filter((a) => a.installed && a.executable !== false) ??
      [],
    [discovery],
  )
  const allModels = discovery?.models ?? {}

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const firstStatusId = STATUSES[0].id
  const [input, setInput] = useState('')
  const [statusId, setStatusId] = useState(initialStatusId ?? firstStatusId)
  const [priority, setPriority] = useState<Priority>('medium')
  const [engineType, setEngineType] = useState('')
  const [modelId, setModelId] = useState('')
  const [permission, setPermission] = useState<PermissionId>('auto')
  const [useWorktree, setUseWorktree] = useState(false)

  // Resolve the effective engine type ('' means use system default)
  const resolvedEngineType = useMemo(() => {
    if (engineType) return engineType
    const defaultEng = engineSettings?.defaultEngine
    if (defaultEng && installedEngines.some((e) => e.engineType === defaultEng))
      return defaultEng
    return installedEngines[0]?.engineType ?? ''
  }, [engineType, engineSettings, installedEngines])

  // Models for the resolved engine
  const currentModels = useMemo(
    () => (resolvedEngineType ? (allModels[resolvedEngineType] ?? []) : []),
    [resolvedEngineType, allModels],
  )

  // When engine changes, reset model to "default" (system auto)
  const handleEngineChange = useCallback((newEngine: string) => {
    setEngineType(newEngine)
    setModelId('')
  }, [])

  useEffect(() => {
    setStatusId(initialStatusId ?? firstStatusId)
  }, [initialStatusId, firstStatusId])

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [autoFocus])

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || !statusId) return
    const permissionMap: Record<PermissionId, string | undefined> = {
      auto: 'auto',
      ask: 'supervised',
    }
    createIssue.mutate(
      {
        title: trimmed,
        statusId,
        priority,
        useWorktree,
        parentIssueId,
        engineType: resolvedEngineType || undefined,
        model: modelId || undefined,
        permissionMode: permissionMap[permission],
      },
      {
        onSuccess: () => {
          setInput('')
          setEngineType('')
          setModelId('')
          setPriority('medium')
          setPermission('auto')
          setUseWorktree(false)
          onCreated?.()
        },
      },
    )
  }, [
    input,
    statusId,
    priority,
    permission,
    useWorktree,
    parentIssueId,
    resolvedEngineType,
    modelId,
    createIssue,
    onCreated,
  ])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleTextarea = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
      const el = e.target
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    },
    [],
  )

  return (
    <div onKeyDown={handleKeyDown}>
      {/* ─── Input area ─────────────────────────── */}
      <div className="rounded-lg border bg-muted/30 focus-within:ring-1 focus-within:ring-ring transition-shadow">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextarea}
          placeholder={t('issue.describeWork')}
          rows={4}
          className="w-full bg-transparent text-sm resize-none border-none shadow-none outline-none placeholder:text-muted-foreground/50 px-3 pt-3 pb-2 min-h-25 focus-visible:ring-0 rounded-b-none!"
          disabled={createIssue.isPending}
        />
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] text-muted-foreground/50">
            {t('issue.cmdEnterSubmit')}
          </span>
          <span className="text-[11px] text-muted-foreground/50 tabular-nums">
            {input.length} / 2000
          </span>
        </div>
      </div>

      {/* ─── Properties (selectors) ─────────────── */}
      <div className="pt-3.5">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {t('issue.properties')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <PropertyRow label={t('issue.status')}>
            <StatusSelect
              statuses={STATUSES}
              value={statusId}
              onChange={setStatusId}
            />
          </PropertyRow>
          <PropertyRow label={t('issue.priority')}>
            <PrioritySelect value={priority} onChange={setPriority} />
          </PropertyRow>
          <PropertyRow label={t('createIssue.worktree')}>
            <WorktreeToggle value={useWorktree} onChange={setUseWorktree} />
          </PropertyRow>
          <PropertyRow label={t('createIssue.engine')}>
            <EngineSelect
              engines={installedEngines}
              profiles={profiles ?? []}
              value={engineType}
              onChange={handleEngineChange}
            />
          </PropertyRow>
          <PropertyRow label={t('createIssue.model')}>
            <ModelSelect
              models={currentModels}
              value={modelId}
              onChange={setModelId}
            />
          </PropertyRow>
          <PropertyRow label={t('createIssue.mode')}>
            <PermissionSelect value={permission} onChange={setPermission} />
          </PropertyRow>
        </div>
      </div>

      {/* ─── Footer ─────────────────────────────── */}
      <div className="flex items-center justify-end pt-4">
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            onClick={handleSubmit}
            disabled={createIssue.isPending || !input.trim()}
          >
            {createIssue.isPending
              ? t('createIssue.creating')
              : t('createIssue.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Dialog wrapper ───────────────────────────────────

export function CreateIssueDialog() {
  const { t } = useTranslation()
  const { projectId = 'default' } = useParams<{ projectId: string }>()
  const { createDialogOpen, createDialogStatusId, closeCreateDialog } =
    usePanelStore()

  return (
    <Dialog
      open={createDialogOpen}
      onOpenChange={(open) => {
        if (!open) closeCreateDialog()
      }}
    >
      <DialogContent
        className="max-w-[calc(100%-2rem)] md:max-w-[580px]"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>{t('issue.createTask')}</DialogTitle>
        <CreateIssueForm
          projectId={projectId}
          initialStatusId={createDialogStatusId}
          autoFocus={createDialogOpen}
          onCreated={closeCreateDialog}
          onCancel={closeCreateDialog}
        />
      </DialogContent>
    </Dialog>
  )
}

// ── Property row ──────────────────────────────────────

function PropertyRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
      <span className="text-xs text-muted-foreground w-10 shrink-0">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ── Select components ────────────────────────────────
// All replaced with shadcn DropdownMenu; no more useClickOutside / manual open state

function StatusSelect({
  statuses,
  value,
  onChange,
}: {
  statuses: StatusDefinition[]
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const current = statuses.find((s) => s.id === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
        >
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: current?.color }}
          />
          <span className="truncate">
            {current ? tStatus(t, current.name) : t('issue.selectStatus')}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {statuses.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => onChange(s.id)}
            className={s.id === value ? 'bg-accent/50' : ''}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span>{tStatus(t, s.name)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority
  onChange: (p: Priority) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
        >
          <PriorityIcon priority={value} />
          <span className="capitalize truncate">{tPriority(t, value)}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {PRIORITIES.map((p) => (
          <DropdownMenuItem
            key={p}
            onSelect={() => onChange(p)}
            className={p === value ? 'bg-accent/50' : ''}
          >
            <PriorityIcon priority={p} />
            <span className="capitalize">{tPriority(t, p)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EngineSelect({
  engines,
  profiles,
  value,
  onChange,
}: {
  engines: EngineAvailability[]
  profiles: EngineProfile[]
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()

  const isDefault = !value
  const currentProfile = profiles.find((p) => p.engineType === value)
  const currentName = isDefault
    ? t('createIssue.modelDefault')
    : (currentProfile?.name ?? value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
        >
          {value ? (
            <EngineIcon
              engineType={value}
              className="h-3.5 w-3.5 text-muted-foreground shrink-0"
            />
          ) : null}
          <span className="truncate">{currentName}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuItem
          onSelect={() => onChange('')}
          className={isDefault ? 'bg-accent/50' : ''}
        >
          <span className="font-medium">{t('createIssue.modelDefault')}</span>
          <span className="text-[10px] text-muted-foreground ml-1">
            ({t('createIssue.modelDefaultHint')})
          </span>
        </DropdownMenuItem>
        {engines.map((a) => {
          const profile = profiles.find((p) => p.engineType === a.engineType)
          return (
            <DropdownMenuItem
              key={a.engineType}
              onSelect={() => onChange(a.engineType)}
              className={a.engineType === value ? 'bg-accent/50' : ''}
            >
              <EngineIcon
                engineType={a.engineType}
                className="h-3.5 w-3.5 text-muted-foreground shrink-0"
              />
              <span className="font-medium">
                {profile?.name ?? a.engineType}
              </span>
              {a.version ? (
                <span className="text-[10px] text-muted-foreground ml-1">
                  v{a.version}
                </span>
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── WorktreeToggle ────────────────────────────────────
// Replaced manual button with shadcn Switch for better semantics & accessibility

function WorktreeToggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2 w-full">
      <Switch checked={value} onCheckedChange={onChange} className="shrink-0" />
      <span
        className={`text-sm ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
      >
        <GitBranch
          className={`inline h-3.5 w-3.5 mr-1 shrink-0 ${value ? 'text-emerald-500' : 'text-muted-foreground'}`}
        />
        {value ? t('createIssue.worktreeOn') : t('createIssue.worktreeOff')}
      </span>
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
  const { t } = useTranslation()
  const current = value ? models.find((m) => m.id === value) : null
  const isDefault = !value

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
        >
          <span className="truncate">
            {isDefault ? t('createIssue.modelDefault') : (current?.name ?? '—')}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuItem
          onSelect={() => onChange('')}
          className={isDefault ? 'bg-accent/50' : ''}
        >
          <span className="font-medium">{t('createIssue.modelDefault')}</span>
          <span className="text-[10px] text-muted-foreground ml-1">
            ({t('createIssue.modelDefaultHint')})
          </span>
        </DropdownMenuItem>
        {models.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange(m.id)}
            className={m.id === value ? 'bg-accent/50' : ''}
          >
            <span className="font-medium">{m.name}</span>
            {m.isDefault ? (
              <span className="text-[10px] text-muted-foreground ml-1">
                ({t('createIssue.engineLabel.default')})
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── PermissionSelect ──────────────────────────────────

function PermissionSelect({
  value,
  onChange,
}: {
  value: PermissionId
  onChange: (v: PermissionId) => void
}) {
  const { t } = useTranslation()
  const current = PERMISSIONS.find((p) => p.id === value) ?? PERMISSIONS[0]
  const Icon = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
        >
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">
            {t(`createIssue.perm.${current.id}`)}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          {t('createIssue.permission')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PERMISSIONS.map((perm) => {
          const PermIcon = perm.icon
          return (
            <DropdownMenuItem
              key={perm.id}
              onSelect={() => onChange(perm.id)}
              className={perm.id === value ? 'bg-accent/50' : ''}
            >
              <PermIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">
                {t(`createIssue.perm.${perm.id}`)}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
