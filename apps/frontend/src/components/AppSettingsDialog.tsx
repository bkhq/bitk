import { useRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  CircleAlert,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useEngineAvailability,
  useEngineProfiles,
  useEngineSettings,
  useProbeEngines,
  useUpdateDefaultEngine,
  useUpdateEngineModelSetting,
  useUpdateWorkspacePath,
  useWorkspacePath,
} from '@/hooks/use-kanban'
import type {
  EngineAvailability,
  EngineModel,
  EngineProfile,
} from '@/types/kanban'
import { cn } from '@/lib/utils'
import { LANGUAGES } from '@/lib/constants'
import { useTheme } from '@/hooks/use-theme'
import { useClickOutside } from '@/hooks/use-click-outside'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { EngineIcon } from '@/components/EngineIcons'

const THEME_OPTIONS = [
  { id: 'system' as const, labelKey: 'theme.system' },
  { id: 'light' as const, labelKey: 'theme.light' },
  { id: 'dark' as const, labelKey: 'theme.dark' },
]

export function AppSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { data: discovery, isLoading: enginesLoading } =
    useEngineAvailability(open)
  const engines = discovery?.engines
  const models = discovery?.models
  const availableEngines = useMemo(
    () =>
      engines?.filter(
        (e) => e.installed && e.authStatus !== 'unauthenticated',
      ) ?? [],
    [engines],
  )
  const { data: profiles } = useEngineProfiles(open)
  const { data: engineSettings } = useEngineSettings(open)
  const updateModelSetting = useUpdateEngineModelSetting()
  const updateDefaultEngine = useUpdateDefaultEngine()
  const probe = useProbeEngines()
  const showNoAvailableEngines =
    !enginesLoading && availableEngines.length === 0

  const { data: wsData } = useWorkspacePath(open)
  const updateWsPath = useUpdateWorkspacePath()
  const [dirPickerOpen, setDirPickerOpen] = useState(false)

  const handleSelectWorkspace = (path: string) => {
    updateWsPath.mutate(path)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <div className="max-h-[70dvh] overflow-y-auto px-5 pb-5">
          {/* Workspace section */}
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground">
              {t('settings.workspacePath')}
            </label>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono text-muted-foreground truncate">
                {wsData?.path ?? '/'}
              </div>
              <button
                type="button"
                onClick={() => setDirPickerOpen(true)}
                className="flex shrink-0 items-center justify-center rounded-md border px-2.5 py-2 hover:bg-accent transition-colors"
                title={t('settings.browseWorkspace')}
              >
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('settings.workspacePathHint')}
            </p>
            <DirectoryPicker
              open={dirPickerOpen}
              onOpenChange={setDirPickerOpen}
              initialPath={wsData?.path ?? '/'}
              onSelect={handleSelectWorkspace}
            />
          </div>

          {/* Language & Theme */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('settings.language')}
              </label>
              <SettingsSelect
                value={i18n.language}
                options={LANGUAGES.map((l) => ({ id: l.id, label: l.label }))}
                onChange={(id) => i18n.changeLanguage(id)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t('settings.appearance')}
              </label>
              <SettingsSelect
                value={theme}
                options={THEME_OPTIONS.map((o) => ({
                  id: o.id,
                  label: t(o.labelKey),
                }))}
                onChange={(id) => setTheme(id as 'system' | 'light' | 'dark')}
              />
            </div>
          </div>

          {/* Default Engine */}
          {!enginesLoading && availableEngines.length > 0 ? (
            <div className="mb-4">
              <label className="text-xs font-medium text-muted-foreground">
                {t('settings.defaultEngine')}
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {availableEngines.map((eng) => {
                  const profile = profiles?.find(
                    (p) => p.engineType === eng.engineType,
                  )
                  const isSelected =
                    eng.engineType === engineSettings?.defaultEngine ||
                    (!engineSettings?.defaultEngine &&
                      eng.engineType === availableEngines[0]?.engineType)
                  return (
                    <button
                      key={eng.engineType}
                      type="button"
                      onClick={() => updateDefaultEngine.mutate(eng.engineType)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      <EngineIcon
                        engineType={eng.engineType}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      {profile?.name ?? eng.engineType}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('settings.defaultEngineHint')}
              </p>
            </div>
          ) : null}

          {/* Engines section */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('settings.engines')}
            </span>
            <button
              type="button"
              onClick={() => probe.mutate()}
              disabled={probe.isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
              title={
                probe.isPending ? t('settings.probing') : t('settings.probe')
              }
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', probe.isPending && 'animate-spin')}
              />
              {probe.isPending ? t('settings.probing') : t('settings.probe')}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {enginesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('settings.detecting')}
              </div>
            ) : showNoAvailableEngines ? (
              <div className="text-sm text-muted-foreground py-2">
                {t('settings.noAvailableEngines')}
              </div>
            ) : (
              availableEngines.map((engine) => {
                const profile = profiles?.find(
                  (p) => p.engineType === engine.engineType,
                )
                const engineModels = models?.[engine.engineType] ?? []
                const savedDefault =
                  engineSettings?.engines[engine.engineType]?.defaultModel
                return (
                  <EngineCard
                    key={engine.engineType}
                    engine={engine}
                    profile={profile}
                    models={engineModels}
                    savedDefault={savedDefault}
                    onChangeDefault={(modelId) =>
                      updateModelSetting.mutate({
                        engineType: engine.engineType,
                        defaultModel: modelId,
                      })
                    }
                  />
                )
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EngineCard({
  engine,
  profile,
  models,
  savedDefault,
  onChangeDefault,
}: {
  engine: EngineAvailability
  profile?: EngineProfile
  models: EngineModel[]
  savedDefault?: string
  onChangeDefault: (modelId: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasModels = models.length > 0
  const builtInDefault = models.find((m) => m.isDefault)
  const selectedModel = savedDefault ?? builtInDefault?.id ?? ''
  const selectedModelName = models.find((m) => m.id === selectedModel)?.name

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => hasModels && setExpanded((v) => !v)}
        className={cn(
          'flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors',
          hasModels && 'hover:bg-accent/50 cursor-pointer',
          !hasModels && 'cursor-default',
        )}
      >
        <EngineIcon
          engineType={engine.engineType}
          className="h-4 w-4 text-muted-foreground shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {profile?.name ?? engine.engineType}
            </span>
            {engine.version ? (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                v{engine.version}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            {selectedModelName ? (
              <span className="truncate">{selectedModelName}</span>
            ) : null}
            {selectedModelName && hasModels ? (
              <span className="text-muted-foreground/50">·</span>
            ) : null}
            {hasModels ? (
              <span className="shrink-0">
                {t('settings.models', { count: models.length })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {engine.installed ? (
            <>
              <StatusBadge ok label={t('settings.engineInstalled')} />
              {engine.authStatus === 'authenticated' ? (
                <StatusBadge ok label={t('settings.engineAuthenticated')} />
              ) : engine.authStatus === 'unauthenticated' ? (
                <StatusBadge
                  ok={false}
                  label={t('settings.engineUnauthenticated')}
                />
              ) : null}
            </>
          ) : (
            <StatusBadge ok={false} label={t('settings.engineNotInstalled')} />
          )}
          {hasModels ? (
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                expanded && 'rotate-180',
              )}
            />
          ) : null}
        </div>
      </button>

      {/* Expanded model list */}
      {expanded && hasModels ? (
        <div className="border-t px-3 py-2 flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            {t('settings.defaultModel')}
          </span>
          {models.map((m) => {
            const isSelected = m.id === selectedModel
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeDefault(m.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors text-left',
                  isSelected
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/80 hover:bg-accent/50',
                )}
              >
                <span className="flex-1 truncate">
                  {m.name}
                  {m.isDefault
                    ? ` (${t('createIssue.engineLabel.default')})`
                    : ''}
                </span>
                {isSelected ? <Check className="h-3 w-3 shrink-0" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SettingsSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const selected = options.find((o) => o.id === value) ?? options[0]

  return (
    <div ref={ref} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full mt-1 z-[60] rounded-lg border bg-popover py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
                opt.id === value ? 'bg-accent/50 font-medium' : ''
              }`}
            >
              {opt.label}
              {opt.id === value ? (
                <Check className="h-3 w-3 ml-auto shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        ok
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      )}
    >
      {ok ? (
        <Check className="h-2.5 w-2.5" />
      ) : (
        <CircleAlert className="h-2.5 w-2.5" />
      )}
      {label}
    </span>
  )
}
