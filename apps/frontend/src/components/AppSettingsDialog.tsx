import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Settings,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { EngineIcon } from '@/components/EngineIcons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SettingsNavItem } from '@/components/ui/settings-layout'
import { SettingsLayout } from '@/components/ui/settings-layout'
import { Switch } from '@/components/ui/switch'
import {
  useCheckForUpdates,
  useDownloadStatus,
  useDownloadUpdate,
  useEngineAvailability,
  useEngineProfiles,
  useEngineSettings,
  useProbeEngines,
  useRestartWithUpgrade,
  useSetUpgradeEnabled,
  useSetWorktreeAutoCleanup,
  useUpdateDefaultEngine,
  useUpdateEngineModelSetting,
  useUpdateWorkspacePath,
  useUpgradeCheck,
  useUpgradeEnabled,
  useVersionInfo,
  useWorkspacePath,
  useWorktreeAutoCleanup,
} from '@/hooks/use-kanban'
import { useTheme } from '@/hooks/use-theme'
import { LANGUAGES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type {
  EngineAvailability,
  EngineModel,
  EngineProfile,
} from '@/types/kanban'

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
  const { t } = useTranslation()

  const navItems: SettingsNavItem[] = useMemo(
    () => [
      { id: 'general', label: t('settings.tabGeneral'), icon: Settings },
      { id: 'models', label: t('settings.tabModels'), icon: Box },
      { id: 'about', label: t('settings.tabAbout'), icon: Info },
    ],
    [t],
  )

  return (
    <SettingsLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      items={navItems}
      defaultItem="general"
    >
      {(active) => (
        <>
          {active === 'general' && <GeneralSection open={open} />}
          {active === 'models' && <ModelsSection open={open} />}
          {active === 'about' && <AboutSection open={open} />}
        </>
      )}
    </SettingsLayout>
  )
}

function GeneralSection({ open }: { open: boolean }) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { data: wsData } = useWorkspacePath(open)
  const updateWsPath = useUpdateWorkspacePath()
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const { data: worktreeCleanupData } = useWorktreeAutoCleanup(open)
  const setWorktreeAutoCleanup = useSetWorktreeAutoCleanup()

  const handleSelectWorkspace = (path: string) => {
    updateWsPath.mutate(path)
  }

  return (
    <div className="space-y-4">
      <Field>
        <Label>{t('settings.workspacePath')}</Label>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 rounded-md border bg-muted/50 px-2 py-1.5 text-sm font-mono text-muted-foreground truncate">
            {wsData?.path ?? '/'}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDirPickerOpen(true)}
          >
            <FolderOpen className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('settings.workspacePathHint')}
        </p>
        <DirectoryPicker
          open={dirPickerOpen}
          onOpenChange={setDirPickerOpen}
          initialPath={wsData?.path ?? '/'}
          onSelect={handleSelectWorkspace}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>{t('settings.language')}</Label>
          <Select
            value={i18n.language}
            onValueChange={(value) => i18n.changeLanguage(value ?? undefined)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.id} value={lang.id}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <Label>{t('settings.appearance')}</Label>
          <Select
            value={theme}
            onValueChange={(value) =>
              setTheme(value as 'system' | 'light' | 'dark')
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">
            {t('settings.worktreeAutoCleanup')}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.worktreeAutoCleanupHint')}
          </p>
        </div>
        <Switch
          size="sm"
          checked={worktreeCleanupData?.enabled ?? false}
          onCheckedChange={(checked) => setWorktreeAutoCleanup.mutate(checked)}
        />
      </div>
    </div>
  )
}

function ModelsSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
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

  return (
    <div className="space-y-4">
      {!enginesLoading && availableEngines.length > 0 ? (
        <Field>
          <Label>{t('settings.defaultEngine')}</Label>
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
          <p className="text-[11px] text-muted-foreground">
            {t('settings.defaultEngineHint')}
          </p>
        </Field>
      ) : null}

      <div className="flex items-center justify-between">
        <Label>{t('settings.engines')}</Label>
        <Button
          onClick={() => probe.mutate()}
          variant="ghost"
          size="sm"
          disabled={probe.isPending}
        >
          <RefreshCw
            className={cn('size-3', probe.isPending && 'animate-spin')}
          />
          {probe.isPending ? t('settings.probing') : t('settings.probe')}
        </Button>
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
  )
}

function AboutSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: versionInfo } = useVersionInfo(open)
  const { data: upgradeEnabledData } = useUpgradeEnabled(open)
  const setUpgradeEnabled = useSetUpgradeEnabled()
  const { data: checkResult } = useUpgradeCheck(
    open && (upgradeEnabledData?.enabled ?? false),
  )
  const checkForUpdates = useCheckForUpdates()
  const downloadUpdate = useDownloadUpdate()
  const restartWithUpgrade = useRestartWithUpgrade()
  const { data: dlStatus } = useDownloadStatus(
    open && (upgradeEnabledData?.enabled ?? false),
  )

  const isEnabled = upgradeEnabledData?.enabled ?? true

  const handleToggle = (checked: boolean) => {
    setUpgradeEnabled.mutate(checked)
  }

  const handleCheck = () => {
    checkForUpdates.mutate()
  }

  const handleDownload = () => {
    if (checkResult?.downloadUrl && checkResult?.downloadFileName) {
      downloadUpdate.mutate({
        url: checkResult.downloadUrl,
        fileName: checkResult.downloadFileName,
        checksumUrl: checkResult.checksumUrl ?? undefined,
      })
    }
  }

  const handleRestart = () => {
    restartWithUpgrade.mutate()
  }

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-3">
      {/* Version & Build */}
      <div className="mt-1.5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">
            {t('settings.currentVersion')}
          </span>
          <Badge variant="outline" className="shrink-0 font-mono">
            {versionInfo?.version === 'dev'
              ? t('settings.devBuild')
              : `v${versionInfo?.version ?? '...'}`}
          </Badge>
          {versionInfo?.isPackageMode ? (
            <Badge variant="secondary" className="shrink-0 text-[10px] py-0">
              {t('settings.packageMode')}
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">
            {t('settings.buildId')}
          </span>
          <span
            className="min-w-0 truncate font-mono text-foreground/80"
            title={versionInfo?.commit ?? '...'}
          >
            {versionInfo?.commit ?? '...'}
          </span>
        </div>
      </div>

      {/* Auto-upgrade toggle */}
      <div className="mt-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">
            {t('settings.upgradeEnabled')}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.upgradeEnabledHint')}
          </p>
        </div>
        <Switch size="sm" checked={isEnabled} onCheckedChange={handleToggle} />
      </div>

      {/* Upgrade status */}
      {isEnabled ? (
        <div className="mt-3 rounded-lg border p-3">
          {checkForUpdates.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('settings.upgradeChecking')}
            </div>
          ) : checkResult?.hasUpdate ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                <ArrowDownToLine className="h-3.5 w-3.5 text-blue-500" />
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  {t('settings.upgradeAvailable', {
                    version: checkResult.latestVersion,
                  })}
                </span>
              </div>
              {dlStatus?.status === 'downloading' ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('settings.upgradeDownloading', {
                      progress: dlStatus.progress,
                    })}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${dlStatus.progress}%` }}
                    />
                  </div>
                </div>
              ) : dlStatus?.status === 'verifying' ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('settings.upgradeVerifying')}
                </div>
              ) : dlStatus?.status === 'verified' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <CircleCheck className="h-3 w-3" />
                    {t('settings.upgradeVerified')}
                    <Badge variant="outline" className="text-[10px] py-0">
                      {t('settings.upgradeChecksumOk')}
                    </Badge>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRestart}
                    disabled={restartWithUpgrade.isPending}
                  >
                    {restartWithUpgrade.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {restartWithUpgrade.isPending
                      ? t('settings.upgradeRestarting')
                      : t('settings.upgradeRestart')}
                  </Button>
                </div>
              ) : dlStatus?.status === 'completed' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <CircleCheck className="h-3 w-3" />
                    {t('settings.upgradeDownloaded')}
                    {dlStatus.fileName ? (
                      <span
                        className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                        title={dlStatus.fileName}
                      >
                        {dlStatus.fileName}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRestart}
                    disabled={restartWithUpgrade.isPending}
                  >
                    {restartWithUpgrade.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {restartWithUpgrade.isPending
                      ? t('settings.upgradeRestarting')
                      : t('settings.upgradeRestart')}
                  </Button>
                </div>
              ) : dlStatus?.status === 'failed' ? (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                  <CircleAlert className="h-3 w-3" />
                  {t('settings.upgradeDownloadFailed')}
                  {dlStatus.checksumMatch === false ? (
                    <Badge variant="destructive" className="text-[10px] py-0">
                      {t('settings.upgradeChecksumFailed')}
                    </Badge>
                  ) : null}
                </div>
              ) : checkResult.downloadUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={downloadUpdate.isPending}
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  {t('settings.upgradeDownload')}
                  {checkResult.assetSize ? (
                    <span className="text-muted-foreground ml-1">
                      ({(checkResult.assetSize / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  ) : null}
                </Button>
              ) : null}
            </div>
          ) : checkResult ? (
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="h-3 w-3" />
              {t('settings.upgradeUpToDate')}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {t('settings.upgradeNoRelease')}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between">
            {checkResult?.checkedAt ? (
              <span className="text-[10px] text-muted-foreground">
                {t('settings.upgradeLastChecked', {
                  time: formatTime(checkResult.checkedAt),
                })}
              </span>
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCheck}
              disabled={checkForUpdates.isPending}
            >
              <RefreshCw
                className={cn(
                  'h-3 w-3',
                  checkForUpdates.isPending && 'animate-spin',
                )}
              />
              {t('settings.upgradeCheckNow')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
          className="size-4 text-muted-foreground shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {profile?.name ?? engine.engineType}
            </span>
            {engine.version && (
              <Badge variant="outline" className="shrink-0">
                v{engine.version}
              </Badge>
            )}
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
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
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
