import {
  ChevronDown,
  ChevronsRight,
  GitBranch,
  MousePointerClick,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EngineIcon } from '@/components/EngineIcons'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useClickOutside } from '@/hooks/use-click-outside'
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

// ── Shared primitives ─────────────────────────────────

function DropdownPanel({
  children,
  className,
  heading,
}: {
  children: React.ReactNode
  className?: string
  heading?: string
}) {
  return (
    <div
      className={`absolute left-0 top-full mt-1 z-[60] rounded-lg border bg-popover shadow-lg ${className ?? ''}`}
    >
      {heading ? (
        <div className="px-3 pt-2 pb-1">
          <span className="text-xs font-semibold text-muted-foreground">
            {heading}
          </span>
        </div>
      ) : null}
      <div className="py-1">{children}</div>
    </div>
  )
}

function DropdownItem({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
        active ? 'bg-accent/50' : ''
      }`}
    >
      {children}
    </button>
  )
}

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
    // Map UI permission IDs to backend permission modes
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
      <div className="px-5">
        <div className="rounded-lg border bg-muted/30 focus-within:ring-1 focus-within:ring-ring transition-shadow">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextarea}
            placeholder={t('issue.describeWork')}
            rows={4}
            className="w-full bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 px-3 pt-3 pb-2 min-h-[100px]"
            disabled={createIssue.isPending}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-[11px] text-muted-foreground/50">
              {t('issue.cmdEnterSubmit')}
            </span>
            <span className="text-[11px] text-muted-foreground/50 tabular-nums">
              {input.length} / 2000
            </span>
          </div>
        </div>
      </div>

      {/* ─── Properties (selectors) ─────────────── */}
      <div className="px-5 pt-3.5">
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
      <div className="flex items-center justify-end px-5 pt-4 pb-4">
        <div className="flex items-center gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              {t('common.cancel')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createIssue.isPending || !input.trim()}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            {createIssue.isPending
              ? t('createIssue.creating')
              : t('createIssue.create')}
          </button>
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
        className="flex flex-col gap-0 p-0 max-w-[calc(100%-2rem)] md:max-w-[580px] max-h-[calc(100dvh-2rem)] rounded-xl overflow-visible"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t('issue.createTask')}</DialogTitle>

        {/* ─── Header ─────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('issue.createTask')}
          </h2>
          <button
            type="button"
            onClick={closeCreateDialog}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

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

// ── Select components (inline in property rows) ──────

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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = statuses.find((s) => s.id === value)

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
      {open ? (
        <DropdownPanel className="min-w-[160px]">
          {statuses.map((s) => (
            <DropdownItem
              key={s.id}
              active={s.id === value}
              onClick={() => {
                onChange(s.id)
                setOpen(false)
              }}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span>{tStatus(t, s.name)}</span>
            </DropdownItem>
          ))}
        </DropdownPanel>
      ) : null}
    </div>
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
      >
        <PriorityIcon priority={value} />
        <span className="capitalize truncate">{tPriority(t, value)}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
      </button>
      {open ? (
        <DropdownPanel className="w-36">
          {PRIORITIES.map((p) => (
            <DropdownItem
              key={p}
              active={p === value}
              onClick={() => {
                onChange(p)
                setOpen(false)
              }}
            >
              <PriorityIcon priority={p} />
              <span className="capitalize">{tPriority(t, p)}</span>
            </DropdownItem>
          ))}
        </DropdownPanel>
      ) : null}
    </div>
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const isDefault = !value
  const currentProfile = profiles.find((p) => p.engineType === value)
  const currentName = isDefault
    ? t('createIssue.modelDefault')
    : (currentProfile?.name ?? value)

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
      {open ? (
        <DropdownPanel className="min-w-[200px]">
          <DropdownItem
            active={isDefault}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            <span className="font-medium">{t('createIssue.modelDefault')}</span>
            <span className="text-[10px] text-muted-foreground">
              ({t('createIssue.modelDefaultHint')})
            </span>
          </DropdownItem>
          {engines.map((a) => {
            const profile = profiles.find((p) => p.engineType === a.engineType)
            return (
              <DropdownItem
                key={a.engineType}
                active={a.engineType === value}
                onClick={() => {
                  onChange(a.engineType)
                  setOpen(false)
                }}
              >
                <EngineIcon
                  engineType={a.engineType}
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                />
                <span className="font-medium">
                  {profile?.name ?? a.engineType}
                </span>
                {a.version ? (
                  <span className="text-[10px] text-muted-foreground">
                    v{a.version}
                  </span>
                ) : null}
              </DropdownItem>
            )
          })}
        </DropdownPanel>
      ) : null}
    </div>
  )
}

function WorktreeToggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
    >
      <GitBranch
        className={`h-3.5 w-3.5 shrink-0 ${value ? 'text-emerald-500' : 'text-muted-foreground'}`}
      />
      <span className={value ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {value ? t('createIssue.worktreeOn') : t('createIssue.worktreeOff')}
      </span>
    </button>
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = value ? models.find((m) => m.id === value) : null
  const isDefault = !value

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
      >
        <span className="truncate">
          {isDefault ? t('createIssue.modelDefault') : (current?.name ?? '—')}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
      </button>
      {open ? (
        <DropdownPanel className="min-w-[220px]">
          <DropdownItem
            active={isDefault}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            <span className="font-medium">{t('createIssue.modelDefault')}</span>
            <span className="text-[10px] text-muted-foreground">
              ({t('createIssue.modelDefaultHint')})
            </span>
          </DropdownItem>
          {models.map((m) => (
            <DropdownItem
              key={m.id}
              active={m.id === value}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
            >
              <span className="font-medium">{m.name}</span>
              {m.isDefault ? (
                <span className="text-[10px] text-muted-foreground">
                  ({t('createIssue.engineLabel.default')})
                </span>
              ) : null}
            </DropdownItem>
          ))}
        </DropdownPanel>
      ) : null}
    </div>
  )
}

// ── Permission select (inline in property row) ───────

function PermissionSelect({
  value,
  onChange,
}: {
  value: PermissionId
  onChange: (v: PermissionId) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = PERMISSIONS.find((p) => p.id === value) ?? PERMISSIONS[0]
  const Icon = current.icon

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors w-full"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{t(`createIssue.perm.${current.id}`)}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
      </button>
      {open ? (
        <DropdownPanel
          className="min-w-[140px]"
          heading={t('createIssue.permission')}
        >
          {PERMISSIONS.map((perm) => {
            const PermIcon = perm.icon
            return (
              <DropdownItem
                key={perm.id}
                active={perm.id === value}
                onClick={() => {
                  onChange(perm.id)
                  setOpen(false)
                }}
              >
                <PermIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium">
                  {t(`createIssue.perm.${perm.id}`)}
                </span>
              </DropdownItem>
            )
          })}
        </DropdownPanel>
      ) : null}
    </div>
  )
}
