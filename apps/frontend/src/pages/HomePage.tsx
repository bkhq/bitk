import {
  Check,
  Copy,
  Eye,
  FolderOpen,
  Hash,
  Menu,
  Plus,
  Settings,
  StickyNote,
  TerminalSquare,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useProjects } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { useProjectStats } from '@/hooks/use-project-stats'
import { getProjectInitials } from '@/lib/format'
import { useNotesStore } from '@/stores/notes-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import type { Project } from '@/types/kanban'

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const { t } = useTranslation()
  const stats = useProjectStats(project.id)
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!project.directory) return
    void navigator.clipboard.writeText(project.directory).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <>
      <Card
        className="h-full bg-card/70 hover:bg-card cursor-pointer transition-all hover:shadow-md hover:border-primary/20 group"
        onClick={onClick}
      >
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold bg-muted text-muted-foreground">
              {getProjectInitials(project.name)}
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-baseline gap-1.5 text-base group-hover:text-primary transition-colors">
                <span className="truncate">{project.name}</span>
                <span className="shrink-0 text-[10px] font-normal font-mono text-muted-foreground/60">
                  {project.id}
                </span>
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
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="mt-auto">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {project.directory ? (
              <button
                type="button"
                onClick={handleCopyPath}
                className="group/path flex min-w-0 items-center gap-1 hover:text-foreground transition-colors text-left"
                title={t('project.copyPath')}
              >
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{project.directory}</span>
                {copied ? (
                  <Check className="h-3 w-3 shrink-0 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover/path:opacity-100 transition-opacity" />
                )}
              </button>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Hash className="h-3 w-3" />
              {stats.issueCount}
            </span>
          </div>
        </CardContent>
      </Card>
      <ProjectSettingsDialog open={showSettings} onOpenChange={setShowSettings} project={project} />
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
  const navigate = useNavigate()
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
        <SheetContent side="right" className="w-72 p-0" aria-describedby={undefined}>
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

              {/* Review */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  void navigate('/review')
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Eye className="h-4.5 w-4.5 text-muted-foreground" />
                {t('viewMode.review')}
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

              {/* Notes */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  useNotesStore.getState().openFullscreen()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <StickyNote className="h-4.5 w-4.5 text-muted-foreground" />
                {t('notes.title')}
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
  const navigate = useNavigate()

  return (
    <div className="ml-auto flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={() => navigate('/review')}
        aria-label={t('viewMode.review')}
        title={t('viewMode.review')}
      >
        <Eye className="h-4 w-4" />
      </Button>
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
        onClick={useNotesStore.getState().toggle}
        aria-label={t('notes.title')}
      >
        <StickyNote className="h-4 w-4" />
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
    (alias: string) => (isMobile ? `/projects/${alias}/issues` : globalProjectPath(alias)),
    [isMobile, globalProjectPath],
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

      <CreateProjectDialog open={showCreate} onOpenChange={setShowCreate} />
      <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </main>
  )
}
