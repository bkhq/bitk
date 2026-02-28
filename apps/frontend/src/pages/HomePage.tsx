import { useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  List,
  Plus,
  Hash,
  Layers,
  Menu,
  MoreVertical,
  Settings,
  TerminalSquare,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjects } from '@/hooks/use-kanban'
import { useProjectStats } from '@/hooks/use-project-stats'
import type { Project } from '@/types/kanban'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useState, useCallback, useRef } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { AppLogo } from '@/components/AppLogo'
import { useViewModeStore } from '@/stores/view-mode-store'
import { useClickOutside } from '@/hooks/use-click-outside'
import { getProjectInitials } from '@/lib/format'
import { useTerminalStore } from '@/stores/terminal-store'

function ProjectCard({
  project,
  onClick,
}: {
  project: Project
  onClick: () => void
}) {
  const { t } = useTranslation()
  const stats = useProjectStats(project.id)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      <Card
        className="bg-card/70 hover:bg-card cursor-pointer transition-all hover:shadow-md hover:border-primary/20 group"
        onClick={onClick}
      >
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold bg-muted text-muted-foreground">
              {getProjectInitials(project.name)}
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base group-hover:text-primary transition-colors truncate">
                {project.name}
              </CardTitle>
              {project.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {project.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowSettings(true)
              }}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07] transition-colors"
              aria-label={t('project.settings')}
              title={t('project.settings')}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {t('project.issueCount', { count: stats.issueCount })}
            </span>
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {t('project.statusCount', { count: stats.statusCount })}
            </span>
          </div>
        </CardContent>
      </Card>
      <ProjectSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        project={project}
      />
    </>
  )
}

/* -- Mobile menu sheet (right-side) -------------------- */

function MobileHomeMenu({
  onCreateProject,
  onOpenSettings,
}: {
  onCreateProject: () => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground md:hidden"
        aria-label={t('sidebar.menu')}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-72 p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t('sidebar.menu')}</SheetTitle>
          <div className="flex flex-col h-full">
            {/* Actions -- no header */}
            <div className="flex-1 pt-2">
              {/* New project */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onCreateProject()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Plus className="h-4.5 w-4.5 text-muted-foreground" />
                {t('project.newProject')}
              </button>

              <Separator />

              {/* Terminal */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  useTerminalStore.getState().openFullscreen()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <TerminalSquare className="h-4.5 w-4.5 text-muted-foreground" />
                {t('terminal.title')}
              </button>

              {/* Settings */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Settings className="h-4.5 w-4.5 text-muted-foreground" />
                {t('sidebar.settings')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/* -- Desktop header controls (inline) ------------------- */

function DesktopHeaderControls({
  onCreateProject,
  onOpenSettings,
}: {
  onCreateProject: () => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()

  const { mode, setMode } = useViewModeStore()
  const [viewOpen, setViewOpen] = useState(false)
  const viewRef = useRef<HTMLDivElement>(null)
  useClickOutside(viewRef, viewOpen, () => setViewOpen(false))

  const ViewIcon = mode === 'kanban' ? LayoutGrid : List

  return (
    <div className="ml-auto flex items-center gap-2">
      {/* View mode dropdown */}
      <div ref={viewRef} className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground"
          onClick={() => setViewOpen((v) => !v)}
        >
          <ViewIcon className="h-4 w-4" />
          <span className="text-xs">
            {mode === 'kanban' ? t('viewMode.kanban') : t('viewMode.list')}
          </span>
        </Button>
        {viewOpen ? (
          <div className="absolute right-0 top-full mt-1 z-[100] min-w-[120px] rounded-md border bg-popover py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMode('kanban')
                setViewOpen(false)
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
                setViewOpen(false)
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

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={useTerminalStore.getState().toggle}
        aria-label={t('terminal.title')}
      >
        <TerminalSquare className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={onOpenSettings}
        aria-label={t('sidebar.settings')}
      >
        <Settings className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={onCreateProject}>
        <Plus className="h-4 w-4" />
        {t('project.newProject')}
      </Button>
    </div>
  )
}

/* -- Main page ------------------------------------------ */

export default function HomePage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: projects, isLoading } = useProjects()
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const isMobile = useIsMobile()
  const globalProjectPath = useViewModeStore((s) => s.projectPath)

  // Mobile always uses list mode
  const projectPath = useCallback(
    (alias: string) =>
      isMobile ? `/projects/${alias}/issues` : globalProjectPath(alias),
    [isMobile, globalProjectPath],
  )

  const handleProjectCreated = useCallback(
    (project: Project) => {
      navigate(projectPath(project.alias))
    },
    [navigate, projectPath],
  )

  return (
    <main className="min-h-screen text-foreground animate-page-enter">
      <section className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-12">
        {/* Header row -- always horizontal */}
        <div className="mb-6 flex items-center gap-3 md:mb-8">
          <AppLogo className="h-9 w-9" />
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {t('project.projects')}
          </h1>
          {projects ? (
            <Badge variant="secondary" className="ml-1">
              {projects.length}
            </Badge>
          ) : null}

          {/* Mobile: right-side menu sheet */}
          {isMobile ? (
            <div className="ml-auto">
              <MobileHomeMenu
                onCreateProject={() => setShowCreate(true)}
                onOpenSettings={() => setShowSettings(true)}
              />
            </div>
          ) : (
            <DesktopHeaderControls
              onCreateProject={() => setShowCreate(true)}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="bg-card/30 animate-pulse min-h-[140px]">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 rounded bg-muted" />
                      <div className="h-4 w-12 rounded bg-muted" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-3 w-32 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects?.map((project, index) => (
              <div
                key={project.id}
                className="animate-card-enter"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <ProjectCard
                  project={project}
                  onClick={() => navigate(projectPath(project.alias))}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <CreateProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleProjectCreated}
      />
      <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </main>
  )
}
