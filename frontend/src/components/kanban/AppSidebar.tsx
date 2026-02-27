import { useRef, useState, useCallback } from 'react'
import {
  Globe,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  TerminalSquare,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Project } from '@/types/kanban'
import { useProjects } from '@/hooks/use-kanban'
import { useEventConnection } from '@/hooks/use-event-connection'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { AppLogo } from '@/components/AppLogo'
import { useTheme } from '@/hooks/use-theme'
import { useViewModeStore } from '@/stores/view-mode-store'
import { useClickOutside } from '@/hooks/use-click-outside'
import { getProjectInitials } from '@/lib/format'
import { LANGUAGES } from '@/lib/constants'
import { useTerminalStore } from '@/stores/terminal-store'

function ProjectButton({
  project,
  isActive,
  onClick,
}: {
  project: Project
  isActive: boolean
  onClick: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)

  const showTooltip = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setTooltip({ x: rect.right + 10, y: rect.top + rect.height / 2 })
    }
  }

  return (
    <>
      <div className="relative flex items-center justify-center">
        {isActive ? (
          <span className="absolute left-[-9px] h-5 w-[3px] rounded-r-full bg-primary" />
        ) : null}
        <button
          ref={btnRef}
          type="button"
          onClick={onClick}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setTooltip(null)}
          className={`flex items-center justify-center w-9 h-9 rounded-xl text-[11px] font-bold transition-all cursor-pointer focus:outline-none ${
            isActive
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-foreground/[0.07] text-foreground/60 hover:bg-foreground/[0.13] hover:text-foreground/80'
          }`}
          aria-label={project.name}
        >
          {getProjectInitials(project.name)}
        </button>
      </div>
      {tooltip ? (
        <div
          className="fixed z-[100] whitespace-nowrap rounded-md bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md border border-border pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateY(-50%)',
          }}
        >
          {project.name}
        </div>
      ) : null}
    </>
  )
}

export function AppSidebar({ activeProjectId }: { activeProjectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const projectPath = useViewModeStore((s) => s.projectPath)
  const connected = useEventConnection()
  const toggleTerminal = useTerminalStore((s) => s.toggle)
  const isTerminalMinimized = useTerminalStore((s) => s.isMinimized)

  const handleProjectCreated = useCallback(
    (project: Project) => {
      setShowCreate(false)
      navigate(projectPath(project.alias))
    },
    [navigate, projectPath],
  )

  return (
    <div className="flex flex-col items-center h-full w-14 py-3 gap-1 bg-sidebar border-r border-sidebar-border shrink-0">
      {/* Home */}
      <button
        type="button"
        className="flex items-center justify-center w-9 h-9 rounded-xl cursor-pointer focus:outline-none"
        aria-label={t('sidebar.home')}
        title={t('sidebar.home')}
        onClick={() => navigate('/')}
      >
        <AppLogo className="h-9 w-9" />
      </button>

      <Separator className="mx-2 my-1 w-8" />

      {/* Project list */}
      <div
        className="flex flex-col items-center gap-2 overflow-y-auto flex-1 py-1 px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {projects?.map((project) => (
          <ProjectButton
            key={project.id}
            project={project}
            isActive={activeProjectId === project.alias}
            onClick={() => navigate(projectPath(project.alias))}
          />
        ))}
      </div>

      {/* Create project */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowCreate(true)}
        className="h-9 w-9 text-muted-foreground"
        aria-label={t('sidebar.createProject')}
        title={t('sidebar.createProject')}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <CreateProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleProjectCreated}
      />

      {/* Bottom section */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTerminal}
          className="relative h-9 w-9 text-muted-foreground"
          aria-label={t('terminal.title')}
          title={t('terminal.title')}
        >
          <TerminalSquare className="h-4 w-4" />
          {isTerminalMinimized && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
        <ViewModeToggle />
        <Separator className="mx-2 my-0.5 w-8" />
        <LanguageSelector />
        <ThemeToggle />
        <div
          className={`flex items-center justify-center h-9 w-9 ${connected ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
          title={connected ? t('session.connected') : t('session.disconnected')}
        >
          {connected ? (
            <Wifi className="h-4 w-4" />
          ) : (
            <WifiOff className="h-4 w-4" />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label={t('sidebar.settings')}
          title={t('sidebar.settings')}
          onClick={() => setShowSettings(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      </div>
    </div>
  )
}

function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const current = LANGUAGES.find((l) => l.id === i18n.language) ?? LANGUAGES[0]

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground"
        aria-label={t('language.switchLanguage')}
        title={current.label}
        onClick={() => setOpen((v) => !v)}
      >
        <Globe className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute left-full bottom-0 ml-2 z-[100] min-w-[120px] rounded-md border bg-popover py-1 shadow-lg">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              type="button"
              onClick={() => {
                i18n.changeLanguage(lang.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
                lang.id === i18n.language ? 'bg-accent/50 font-medium' : ''
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const THEME_OPTIONS = [
  { id: 'system' as const, icon: Monitor, labelKey: 'theme.system' },
  { id: 'light' as const, icon: Sun, labelKey: 'theme.light' },
  { id: 'dark' as const, icon: Moon, labelKey: 'theme.dark' },
]

function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, setTheme, resolved } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const CurrentIcon =
    theme === 'system' ? Monitor : resolved === 'dark' ? Sun : Moon
  const current = THEME_OPTIONS.find((o) => o.id === theme) ?? THEME_OPTIONS[0]

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground"
        aria-label={t('theme.switchTheme')}
        title={t(current.labelKey)}
        onClick={() => setOpen((v) => !v)}
      >
        <CurrentIcon className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute left-full bottom-0 ml-2 z-[100] min-w-[120px] rounded-md border bg-popover py-1 shadow-lg">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setTheme(opt.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
                opt.id === theme ? 'bg-accent/50 font-medium' : ''
              }`}
            >
              <opt.icon className="h-3.5 w-3.5" />
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ViewModeToggle() {
  const { t } = useTranslation()
  const { mode, setMode } = useViewModeStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const Icon = mode === 'kanban' ? LayoutGrid : List

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground"
        aria-label={t('viewMode.switchView')}
        title={mode === 'kanban' ? t('viewMode.kanban') : t('viewMode.list')}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute left-full bottom-0 ml-2 z-[100] min-w-[120px] rounded-md border bg-popover py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMode('kanban')
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
              mode === 'kanban' ? 'bg-accent/50 font-medium' : ''
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {t('viewMode.kanban')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('list')
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent ${
              mode === 'list' ? 'bg-accent/50 font-medium' : ''
            }`}
          >
            <List className="h-3.5 w-3.5" />
            {t('viewMode.list')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
