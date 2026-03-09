import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Filter,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Trash,
  Trash2,
  Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { EngineIcon } from '@/components/EngineIcons'
import { WebhookSection } from '@/components/settings/WebhookSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
  useCleanupStats,
  useClearSystemLogs,
  useDeletedIssues,
  useDownloadStatus,
  useDownloadUpdate,
  useEngineAvailability,
  useEngineProfiles,
  useEngineSettings,
  useLogPageSize,
  useProbeEngines,
  useRestartWithUpgrade,
  useRestoreDeletedIssue,
  useRunCleanup,
  useServerInfo,
  useSetLogPageSize,
  useSetUpgradeEnabled,
  useSetWorktreeAutoCleanup,
  useSystemInfo,
  useSystemLogs,
  useUpdateDefaultEngine,
  useUpdateEngineModelSetting,
  useUpdateServerInfo,
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
import { useViewModeStore } from '@/stores/view-mode-store'
import type { EngineAvailability, EngineModel, EngineProfile } from '@/types/kanban'

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
      { id: 'logs', label: t('settings.tabLogs'), icon: FileText },
      { id: 'cleanup', label: t('settings.tabCleanup'), icon: Trash2 },
      { id: 'recycleBin', label: t('settings.tabRecycleBin'), icon: Trash },
      { id: 'webhooks', label: t('settings.tabWebhooks'), icon: Webhook },
      { id: 'upgrade', label: t('settings.tabUpgrade'), icon: ArrowDownToLine },
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
      {active => (
        <>
          {active === 'general' && <GeneralSection open={open} />}
          {active === 'models' && <ModelsSection open={open} />}
          {active === 'logs' && <LogsSection open={open} />}
          {active === 'cleanup' && <CleanupSection open={open} />}
          {active === 'recycleBin' && <RecycleBinSection open={open} />}
          {active === 'webhooks' && <WebhookSection open={open} />}
          {active === 'upgrade' && <UpgradeSection open={open} />}
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
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)
  const setFullWidthChat = useViewModeStore(s => s.setFullWidthChat)
  const { data: logPageSizeData } = useLogPageSize(open)
  const setLogPageSize = useSetLogPageSize()
  const { data: serverData } = useServerInfo(open)
  const updateServerInfo = useUpdateServerInfo()
  const [serverName, setServerName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [serverInfoLoaded, setServerInfoLoaded] = useState(false)

  const handleSelectWorkspace = (path: string) => {
    updateWsPath.mutate(path)
  }

  useEffect(() => {
    if (serverData && !serverInfoLoaded) {
      setServerName(serverData.name ?? '')
      setServerUrl(serverData.url ?? '')
      setServerInfoLoaded(true)
    }
  }, [serverData, serverInfoLoaded])

  // Reset loaded flag when dialog closes
  useEffect(() => {
    if (!open) setServerInfoLoaded(false)
  }, [open])

  const serverInfoDirty
    = serverInfoLoaded
      && (serverName !== (serverData?.name ?? '') || serverUrl !== (serverData?.url ?? ''))

  const handleSaveServerInfo = () => {
    updateServerInfo.mutate(
      { name: serverName, url: serverUrl },
      {
        onSuccess: (data) => {
          setServerName(data.name ?? '')
          setServerUrl(data.url ?? '')
          // Update page title if name changed
          document.title = data.name || 'BKD'
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <Field>
        <Label>{t('settings.workspacePath')}</Label>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 rounded-md border bg-muted/50 px-2 py-1.5 text-sm font-mono text-muted-foreground truncate">
            {wsData?.path ?? '/'}
          </div>
          <Button variant="outline" size="icon" onClick={() => setDirPickerOpen(true)}>
            <FolderOpen className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.workspacePathHint')}</p>
        <DirectoryPicker
          open={dirPickerOpen}
          onOpenChange={setDirPickerOpen}
          initialPath={wsData?.path ?? '/'}
          onSelect={handleSelectWorkspace}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>{t('settings.serverName')}</Label>
          <Input
            value={serverName}
            onChange={e => setServerName(e.target.value)}
            placeholder="BKD"
          />
        </Field>
        <Field>
          <Label>{t('settings.serverUrl')}</Label>
          <Input
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </Field>
      </div>
      {serverInfoDirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSaveServerInfo} disabled={updateServerInfo.isPending}>
            {updateServerInfo.isPending
              ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                )
              : (
                  <Check className="size-3 mr-1" />
                )}
            {t('settings.saveServerInfo')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>{t('settings.language')}</Label>
          <Select
            value={LANGUAGES.find(l => i18n.language.startsWith(l.id))?.id ?? i18n.language}
            onValueChange={value => i18n.changeLanguage(value ?? undefined)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={LANGUAGES.find(l => i18n.language.startsWith(l.id))?.label}
              />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(lang => (
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
            onValueChange={value => setTheme(value as 'system' | 'light' | 'dark')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map(option => (
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
          <span className="text-sm font-medium">{t('settings.fullWidthChat')}</span>
          <p className="text-[11px] text-muted-foreground">{t('settings.fullWidthChatHint')}</p>
        </div>
        <Switch size="sm" checked={fullWidthChat} onCheckedChange={setFullWidthChat} />
      </div>

      <Field>
        <Label>{t('settings.logPageSize')}</Label>
        <Select
          value={String(logPageSizeData?.size ?? 10)}
          onValueChange={value => setLogPageSize.mutate(Number(value))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 10, 20, 50, 100, 200].map(n => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{t('settings.logPageSizeHint')}</p>
      </Field>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function CleanupItem({
  label,
  hint,
  count,
  disabled,
  loading,
  onClean,
}: {
  label: string
  hint?: string
  count?: number
  disabled?: boolean
  loading: boolean
  onClean: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{label}</span>
          {count != null
            ? (
                <Badge
                  variant={count > 0 ? 'secondary' : 'outline'}
                  className="text-[10px] px-1.5 py-0"
                >
                  {count}
                </Badge>
              )
            : null}
        </div>
        {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClean}
        disabled={disabled || loading || (count != null && count === 0)}
        className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        {t('settings.cleanupAction')}
      </Button>
    </div>
  )
}

const LOG_LEVELS = [
  { level: 0, label: 'ALL' },
  { level: 20, label: 'DEBUG' },
  { level: 30, label: 'INFO' },
  { level: 40, label: 'WARN' },
  { level: 50, label: 'ERROR' },
] as const

function parseLogLevel(line: string): number {
  try {
    const parsed = JSON.parse(line)
    return typeof parsed.level === 'number' ? parsed.level : 30
  } catch {
    return 30
  }
}

function LogsSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: logsData, isLoading, refetch } = useSystemLogs(open, 500)
  const clearLogs = useClearSystemLogs()
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [levelFilter, setLevelFilter] = useState(0)
  const [keyword, setKeyword] = useState('')

  const filteredLines = useMemo(() => {
    if (!logsData?.lines) return []
    const kw = keyword.toLowerCase()
    return logsData.lines.filter((line) => {
      if (levelFilter > 0 && parseLogLevel(line) < levelFilter) return false
      if (kw && !line.toLowerCase().includes(kw)) return false
      return true
    })
  }, [logsData?.lines, levelFilter, keyword])

  const handleScroll = useCallback(() => {
    const el = logContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = logContainerRef.current
    if (el && autoScroll) {
      el.scrollTop = el.scrollHeight
    }
  }, [autoScroll])

  // Auto-scroll when new data arrives
  const prevLinesCount = useRef(0)
  if (filteredLines.length !== prevLinesCount.current) {
    prevLinesCount.current = filteredLines.length
    queueMicrotask(scrollToBottom)
  }

  const handleDownload = () => {
    window.open('/api/settings/system-logs/download', '_blank')
  }

  const handleClear = () => {
    if (window.confirm(t('settings.logsClearConfirm'))) {
      clearLogs.mutate()
    }
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Top bar: stats + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {logsData
            ? (
                <span className="text-[10px] text-muted-foreground">
                  {t('settings.logsFileSize', {
                    size: formatSize(logsData.fileSize),
                  })}
                  {' · '}
                  {t('settings.logsTotalLines', {
                    count: logsData.totalLines,
                  })}
                </span>
              )
            : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3" />
            {t('settings.logsRefresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} disabled={!logsData?.fileSize}>
            <Download className="size-3" />
            {t('settings.logsDownload')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={clearLogs.isPending || !logsData?.fileSize}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {clearLogs.isPending
              ? (
                  <Loader2 className="size-3 animate-spin" />
                )
              : (
                  <Trash2 className="size-3" />
                )}
            {t('settings.logsClear')}
          </Button>
        </div>
      </div>

      {/* Filter bar: level buttons + keyword search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Filter className="size-3 text-muted-foreground mr-1" />
          {LOG_LEVELS.map(l => (
            <button
              key={l.level}
              type="button"
              onClick={() => setLevelFilter(l.level)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                levelFilter === l.level
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={t('settings.logsSearchPlaceholder')}
            className="w-full rounded-md border bg-transparent py-1 pl-7 pr-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {(levelFilter > 0 || keyword) && filteredLines.length !== logsData?.lines.length
          ? (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {t('settings.logsFiltered', {
                  shown: filteredLines.length,
                  total: logsData?.lines.length ?? 0,
                })}
              </span>
            )
          : null}
      </div>

      {/* Log content */}
      {isLoading
        ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('settings.logsLoading')}
            </div>
          )
        : !filteredLines.length
            ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {t('settings.logsEmpty')}
                </div>
              )
            : (
                <div
                  ref={logContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 min-h-0 max-h-[400px] overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed"
                >
                  {filteredLines.map((line, i) => (
                    <LogLine key={i} line={line} highlight={keyword} />
                  ))}
                </div>
              )}
    </div>
  )
}

function HighlightText({ text, highlight }: { text: string, highlight: string }) {
  if (!highlight) return <>{text}</>
  const parts = text.split(
    new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
  )
  const elements: React.ReactNode[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.toLowerCase() === highlight.toLowerCase()) {
      elements.push(
        <mark key={`h${i}`} className="bg-yellow-300/40 text-inherit rounded-sm px-px">
          {part}
        </mark>,
      )
    } else {
      elements.push(part)
    }
  }
  return <>{elements}</>
}

function LogLine({ line, highlight = '' }: { line: string, highlight?: string }) {
  let parsed: { level?: number, msg?: string, time?: number } | null = null
  try {
    parsed = JSON.parse(line)
  } catch {
    // plain text line
  }

  if (!parsed) {
    return (
      <div className="whitespace-pre-wrap break-all py-px">
        <HighlightText text={line} highlight={highlight} />
      </div>
    )
  }

  const levelName
    = parsed.level === 60
      ? 'FATAL'
      : parsed.level === 50
        ? 'ERROR'
        : parsed.level === 40
          ? 'WARN'
          : parsed.level === 30
            ? 'INFO'
            : parsed.level === 20
              ? 'DEBUG'
              : 'TRACE'

  const levelColor
    = parsed.level === 60 || parsed.level === 50
      ? 'text-red-500'
      : parsed.level === 40
        ? 'text-amber-500'
        : parsed.level === 30
          ? 'text-blue-500'
          : 'text-muted-foreground'

  const time = parsed.time ? new Date(parsed.time).toLocaleTimeString() : ''
  const msg = parsed.msg ?? line

  return (
    <div className="whitespace-pre-wrap break-all py-px">
      {time
        ? (
            <span className="text-muted-foreground/60">
              {time}
              {' '}
            </span>
          )
        : null}
      <span className={levelColor}>{levelName}</span>
      {' '}
      <span>
        <HighlightText text={msg} highlight={highlight} />
      </span>
    </div>
  )
}

function CleanupSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: cleanupStats, refetch: refetchStats } = useCleanupStats(open)
  const runCleanup = useRunCleanup()
  const { data: worktreeCleanupData } = useWorktreeAutoCleanup(open)
  const setWorktreeAutoCleanup = useSetWorktreeAutoCleanup()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{t('settings.worktreeAutoCleanup')}</span>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.worktreeAutoCleanupHint')}
          </p>
        </div>
        <Switch
          size="sm"
          checked={worktreeCleanupData?.enabled ?? false}
          onCheckedChange={checked => setWorktreeAutoCleanup.mutate(checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('settings.cleanup')}</p>
        <Button variant="ghost" size="sm" onClick={() => refetchStats()}>
          <RefreshCw className="size-3" />
          {t('settings.cleanupRefresh')}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <CleanupItem
          label={t('settings.cleanupLogs')}
          count={cleanupStats?.logs.logCount}
          hint={
            cleanupStats
              ? t('settings.cleanupLogsHint', {
                  tools: cleanupStats.logs.toolCallCount,
                })
              : undefined
          }
          loading={runCleanup.isPending}
          onClean={() => runCleanup.mutate(['logs'])}
        />
        <CleanupItem
          label={t('settings.cleanupOldVersions')}
          count={cleanupStats?.oldVersions.items.length}
          hint={
            cleanupStats?.oldVersions.totalSize
              ? formatSize(cleanupStats.oldVersions.totalSize)
              : undefined
          }
          disabled={!cleanupStats?.oldVersions.items.length}
          loading={runCleanup.isPending}
          onClean={() => runCleanup.mutate(['oldVersions'])}
        />
        <CleanupItem
          label={t('settings.cleanupWorktrees')}
          count={cleanupStats?.worktrees.count}
          hint={
            cleanupStats?.worktrees.totalSize
              ? formatSize(cleanupStats.worktrees.totalSize)
              : undefined
          }
          disabled={!cleanupStats?.worktrees.count}
          loading={runCleanup.isPending}
          onClean={() => runCleanup.mutate(['worktrees'])}
        />
        <CleanupItem
          label={t('settings.cleanupDeletedIssues')}
          count={cleanupStats?.deletedIssues.issueCount}
          hint={
            cleanupStats?.deletedIssues.projectCount
              ? t('settings.cleanupDeletedIssuesHint', {
                  projects: cleanupStats.deletedIssues.projectCount,
                })
              : undefined
          }
          disabled={
            !cleanupStats?.deletedIssues.issueCount && !cleanupStats?.deletedIssues.projectCount
          }
          loading={runCleanup.isPending}
          onClean={() => runCleanup.mutate(['deletedIssues'])}
        />
      </div>
    </div>
  )
}

function RecycleBinSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: deletedIssues, isLoading } = useDeletedIssues(open)
  const restoreIssue = useRestoreDeletedIssue()

  const formatDate = (iso: string | null) => {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.recycleBinHint')}</p>

      {isLoading
        ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('settings.recycleBinLoading')}
            </div>
          )
        : !deletedIssues?.length
            ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {t('settings.recycleBinEmpty')}
                </div>
              )
            : (
                <div className="flex flex-col gap-1">
                  {deletedIssues.map(issue => (
                    <div key={issue.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{issue.title}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{issue.projectName}</span>
                          <span className="text-muted-foreground/50">·</span>
                          <span>{formatDate(issue.deletedAt)}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreIssue.mutate(issue.id)}
                        disabled={restoreIssue.isPending}
                      >
                        {restoreIssue.isPending
                          ? (
                              <Loader2 className="size-3 animate-spin" />
                            )
                          : (
                              <RotateCcw className="size-3" />
                            )}
                        {t('settings.recycleBinRestore')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
    </div>
  )
}

function ModelsSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: discovery, isLoading: enginesLoading } = useEngineAvailability(open)
  const engines = discovery?.engines
  const models = discovery?.models
  const availableEngines = useMemo(
    () => engines?.filter(e => e.installed && e.authStatus !== 'unauthenticated') ?? [],
    [engines],
  )
  const { data: profiles } = useEngineProfiles(open)
  const { data: engineSettings } = useEngineSettings(open)
  const updateModelSetting = useUpdateEngineModelSetting()
  const updateDefaultEngine = useUpdateDefaultEngine()
  const probe = useProbeEngines()
  const showNoAvailableEngines = !enginesLoading && availableEngines.length === 0

  return (
    <div className="space-y-4">
      {!enginesLoading && availableEngines.length > 0
        ? (
            <Field>
              <Label>{t('settings.defaultEngine')}</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {availableEngines.map((eng) => {
                  const profile = profiles?.find(p => p.engineType === eng.engineType)
                  const isSelected
                    = eng.engineType === engineSettings?.defaultEngine
                      || (!engineSettings?.defaultEngine
                        && eng.engineType === availableEngines[0]?.engineType)
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
                      <EngineIcon engineType={eng.engineType} className="h-3.5 w-3.5 shrink-0" />
                      {profile?.name ?? eng.engineType}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('settings.defaultEngineHint')}</p>
            </Field>
          )
        : null}

      <div className="flex items-center justify-between">
        <Label>{t('settings.engines')}</Label>
        <Button onClick={() => probe.mutate()} variant="ghost" size="sm" disabled={probe.isPending}>
          <RefreshCw className={cn('size-3', probe.isPending && 'animate-spin')} />
          {probe.isPending ? t('settings.probing') : t('settings.probe')}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {enginesLoading
          ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('settings.detecting')}
              </div>
            )
          : showNoAvailableEngines
            ? (
                <div className="text-sm text-muted-foreground py-2">
                  {t('settings.noAvailableEngines')}
                </div>
              )
            : (
                availableEngines.map((engine) => {
                  const profile = profiles?.find(p => p.engineType === engine.engineType)
                  const engineModels = models?.[engine.engineType] ?? []
                  const savedDefault = engineSettings?.engines[engine.engineType]?.defaultModel
                  return (
                    <EngineCard
                      key={engine.engineType}
                      engine={engine}
                      profile={profile}
                      models={engineModels}
                      savedDefault={savedDefault}
                      onChangeDefault={modelId =>
                        updateModelSetting.mutate({
                          engineType: engine.engineType,
                          defaultModel: modelId,
                        })}
                    />
                  )
                })
              )}
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn('text-xs text-right max-w-[60%] truncate', mono && 'font-mono')}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function AboutSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useSystemInfo(open)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('settings.aboutLoading')}
      </div>
    )
  }

  if (isError || !data) {
    return <div className="py-4 text-sm text-muted-foreground">{t('settings.aboutLoadError')}</div>
  }

  return (
    <div className="space-y-4">
      {/* App Info */}
      <div>
        <h4 className="text-xs font-medium mb-1">{t('settings.aboutApp')}</h4>
        <div className="rounded-md border px-3 py-1 divide-y divide-border">
          <InfoRow
            label={t('settings.aboutVersion')}
            value={(
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px] py-0">
                  {data.app.version === 'dev' ? 'dev' : `v${data.app.version}`}
                </Badge>
                {data.app.isPackageMode
                  ? (
                      <Badge variant="secondary" className="text-[10px] py-0">
                        pkg
                      </Badge>
                    )
                  : null}
              </span>
            )}
          />
          <InfoRow label={t('settings.aboutCommit')} value={data.app.commit} mono />
          <InfoRow label={t('settings.aboutUptime')} value={formatUptime(data.app.uptime)} />
          <InfoRow
            label={t('settings.aboutStartedAt')}
            value={new Date(data.app.startedAt).toLocaleString()}
          />
          <InfoRow label="PID" value={data.process.pid} mono />
        </div>
      </div>

      {/* Runtime */}
      <div>
        <h4 className="text-xs font-medium mb-1">{t('settings.aboutRuntime')}</h4>
        <div className="rounded-md border px-3 py-1 divide-y divide-border">
          <InfoRow label="Bun" value={data.runtime.bun} mono />
          <InfoRow
            label={t('settings.aboutPlatform')}
            value={`${data.runtime.platform} / ${data.runtime.arch}`}
          />
          <InfoRow label="Node.js" value={data.runtime.nodeVersion} mono />
        </div>
      </div>
    </div>
  )
}

function UpgradeSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: versionInfo } = useVersionInfo(open)
  const { data: upgradeEnabledData } = useUpgradeEnabled(open)
  const setUpgradeEnabled = useSetUpgradeEnabled()
  const { data: checkResult } = useUpgradeCheck(open && (upgradeEnabledData?.enabled ?? false))
  const checkForUpdates = useCheckForUpdates()
  const downloadUpdate = useDownloadUpdate()
  const restartWithUpgrade = useRestartWithUpgrade()
  const { data: dlStatus } = useDownloadStatus(open && (upgradeEnabledData?.enabled ?? false))

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
          <span className="shrink-0 text-muted-foreground">{t('settings.currentVersion')}</span>
          <Badge variant="outline" className="shrink-0 font-mono">
            {versionInfo?.version === 'dev'
              ? t('settings.devBuild')
              : `v${versionInfo?.version ?? '...'}`}
          </Badge>
          {versionInfo?.isPackageMode
            ? (
                <Badge variant="secondary" className="shrink-0 text-[10px] py-0">
                  {t('settings.packageMode')}
                </Badge>
              )
            : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">{t('settings.buildId')}</span>
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
          <span className="text-sm font-medium">{t('settings.upgradeEnabled')}</span>
          <p className="text-[11px] text-muted-foreground">{t('settings.upgradeEnabledHint')}</p>
        </div>
        <Switch size="sm" checked={isEnabled} onCheckedChange={handleToggle} />
      </div>

      {/* Upgrade status */}
      {isEnabled
        ? (
            <div className="mt-3 rounded-lg border p-3">
              {checkForUpdates.isPending
                ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('settings.upgradeChecking')}
                    </div>
                  )
                : checkResult?.hasUpdate
                  ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <ArrowDownToLine className="h-3.5 w-3.5 text-blue-500" />
                          <span className="font-medium text-blue-600 dark:text-blue-400">
                            {t('settings.upgradeAvailable', {
                              version: checkResult.latestVersion,
                            })}
                          </span>
                        </div>
                        {dlStatus?.status === 'downloading'
                          ? (
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
                            )
                          : dlStatus?.status === 'verifying'
                            ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {t('settings.upgradeVerifying')}
                                </div>
                              )
                            : dlStatus?.status === 'verified'
                              ? (
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
                                      {restartWithUpgrade.isPending
                                        ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          )
                                        : (
                                            <RefreshCw className="h-3 w-3" />
                                          )}
                                      {restartWithUpgrade.isPending
                                        ? t('settings.upgradeRestarting')
                                        : t('settings.upgradeRestart')}
                                    </Button>
                                  </div>
                                )
                              : dlStatus?.status === 'completed'
                                ? (
                                    <div className="flex flex-col gap-2">
                                      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                                        <CircleCheck className="h-3 w-3" />
                                        {t('settings.upgradeDownloaded')}
                                        {dlStatus.fileName
                                          ? (
                                              <span
                                                className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                                                title={dlStatus.fileName}
                                              >
                                                {dlStatus.fileName}
                                              </span>
                                            )
                                          : null}
                                      </div>
                                      <Button
                                        variant="default"
                                        size="sm"
                                        onClick={handleRestart}
                                        disabled={restartWithUpgrade.isPending}
                                      >
                                        {restartWithUpgrade.isPending
                                          ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            )
                                          : (
                                              <RefreshCw className="h-3 w-3" />
                                            )}
                                        {restartWithUpgrade.isPending
                                          ? t('settings.upgradeRestarting')
                                          : t('settings.upgradeRestart')}
                                      </Button>
                                    </div>
                                  )
                                : dlStatus?.status === 'failed'
                                  ? (
                                      <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                                        <CircleAlert className="h-3 w-3" />
                                        {t('settings.upgradeDownloadFailed')}
                                        {dlStatus.checksumMatch === false
                                          ? (
                                              <Badge variant="destructive" className="text-[10px] py-0">
                                                {t('settings.upgradeChecksumFailed')}
                                              </Badge>
                                            )
                                          : null}
                                      </div>
                                    )
                                  : checkResult.downloadUrl
                                    ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={handleDownload}
                                          disabled={downloadUpdate.isPending}
                                        >
                                          <ArrowDownToLine className="h-3 w-3" />
                                          {t('settings.upgradeDownload')}
                                          {checkResult.assetSize
                                            ? (
                                                <span className="text-muted-foreground ml-1">
                                                  (
                                                  {(checkResult.assetSize / 1024 / 1024).toFixed(1)}
                                                  {' '}
                                                  MB)
                                                </span>
                                              )
                                            : null}
                                        </Button>
                                      )
                                    : null}
                      </div>
                    )
                  : checkResult
                    ? (
                        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                          <CircleCheck className="h-3 w-3" />
                          {t('settings.upgradeUpToDate')}
                        </div>
                      )
                    : (
                        <div className="text-xs text-muted-foreground">{t('settings.upgradeNoRelease')}</div>
                      )}

              <div className="mt-2 flex items-center justify-between">
                {checkResult?.checkedAt
                  ? (
                      <span className="text-[10px] text-muted-foreground">
                        {t('settings.upgradeLastChecked', {
                          time: formatTime(checkResult.checkedAt),
                        })}
                      </span>
                    )
                  : (
                      <span />
                    )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCheck}
                  disabled={checkForUpdates.isPending}
                >
                  <RefreshCw className={cn('h-3 w-3', checkForUpdates.isPending && 'animate-spin')} />
                  {t('settings.upgradeCheckNow')}
                </Button>
              </div>
            </div>
          )
        : null}
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
  const builtInDefault = models.find(m => m.isDefault)
  const selectedModel = savedDefault ?? builtInDefault?.id ?? ''
  const selectedModelName = models.find(m => m.id === selectedModel)?.name

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => hasModels && setExpanded(v => !v)}
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
                v
                {engine.version}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            {selectedModelName ? <span className="truncate">{selectedModelName}</span> : null}
            {selectedModelName && hasModels
              ? (
                  <span className="text-muted-foreground/50">·</span>
                )
              : null}
            {hasModels
              ? (
                  <span className="shrink-0">{t('settings.models', { count: models.length })}</span>
                )
              : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {engine.installed
            ? (
                <>
                  <StatusBadge ok label={t('settings.engineInstalled')} />
                  {engine.authStatus === 'authenticated'
                    ? (
                        <StatusBadge ok label={t('settings.engineAuthenticated')} />
                      )
                    : engine.authStatus === 'unauthenticated'
                      ? (
                          <StatusBadge ok={false} label={t('settings.engineUnauthenticated')} />
                        )
                      : null}
                </>
              )
            : (
                <StatusBadge ok={false} label={t('settings.engineNotInstalled')} />
              )}
          {hasModels
            ? (
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-foreground transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              )
            : null}
        </div>
      </button>

      {expanded && hasModels
        ? (
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
                      {m.isDefault ? ` (${t('createIssue.engineLabel.default')})` : ''}
                    </span>
                    {isSelected ? <Check className="h-3 w-3 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>
          )
        : null}
    </div>
  )
}

function StatusBadge({ ok, label }: { ok: boolean, label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        ok
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <CircleAlert className="h-2.5 w-2.5" />}
      {label}
    </span>
  )
}
