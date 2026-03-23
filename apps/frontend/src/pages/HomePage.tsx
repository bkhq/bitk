import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Clock,
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
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useArchivedProjects, useProjects, useSortProject, useUnarchiveProject } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { useProjectStats } from '@/hooks/use-project-stats'
import { getProjectInitials } from '@/lib/format'
import { useNotesStore } from '@/stores/notes-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import type { Project } from '@/types/kanban'

function SortableProjectCard({
  project,
  index,
  onClick,
}: {
  project: Project
  index: number
  onClick: () => void
}) {
  const { t } = useTranslation()
  const stats = useProjectStats(project.id)
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<import('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge').Edge | null>(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: 'project', projectId: project.id, index }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === 'project' && source.data.projectId !== project.id,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { type: 'project', projectId: project.id, index },
            { input, element, allowedEdges: ['left', 'right'] },
          ),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [project.id, index])

  const handleCopyPath = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!project.directory) return
    void navigator.clipboard.writeText(project.directory).then(() => {
      setCopied(true)
      setTimeout(setCopied, 1500, false)
    })
  }

  return (
    <>
      <div
        ref={cardRef}
        className={`relative animate-card-enter ${isDragging ? 'opacity-50 scale-105 shadow-xl z-10 rotate-1' : ''}`}
        style={{ animationDelay: `${index * 60}ms` }}
      >
        {closestEdge === 'left' && (
          <div className="absolute -left-[3px] top-1 bottom-1 w-[2px] rounded-full bg-primary z-10" />
        )}
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
              {project.directory ?
                  (
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      className="group/path flex min-w-0 items-center gap-1 hover:text-foreground transition-colors text-left"
                      title={t('project.copyPath')}
                    >
                      <FolderOpen className="h-3 w-3 shrink-0" />
                      <span className="truncate font-mono">{project.directory}</span>
                      {copied ?
                          (
                            <Check className="h-3 w-3 shrink-0 text-green-500" />
                          ) :
                          (
                            <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover/path:opacity-100 transition-opacity" />
                          )}
                    </button>
                  ) :
                null}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <Hash className="h-3 w-3" />
                {stats.issueCount}
              </span>
            </div>
          </CardContent>
        </Card>
        {closestEdge === 'right' && (
          <div className="absolute -right-[3px] top-1 bottom-1 w-[2px] rounded-full bg-primary z-10" />
        )}
      </div>
      <ProjectSettingsDialog open={showSettings} onOpenChange={setShowSettings} project={project} />
    </>
  )
}

/* -- Archived projects section ------------------------- */

function ArchivedProjectsSection({ projectPath }: { projectPath: (alias: string) => string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const { data: archived } = useArchivedProjects(expanded)
  const unarchive = useUnarchiveProject()

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Archive className="h-4 w-4" />
        {t('project.archivedProjects')}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    )
  }

  if (!archived || archived.length === 0) {
    return (
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Archive className="h-4 w-4" />
          {t('project.archivedProjects')}
          <ChevronDown className="h-3.5 w-3.5 rotate-180 transition-transform" />
        </button>
        <p className="mt-3 text-sm text-muted-foreground">{t('project.noArchivedProjects')}</p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <Archive className="h-4 w-4" />
        {t('project.archivedProjects')}
        <Badge variant="secondary" className="ml-0.5">{archived.length}</Badge>
        <ChevronDown className="h-3.5 w-3.5 rotate-180 transition-transform" />
      </button>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {archived.map((project, index) => (
          <div
            key={project.id}
            className="animate-card-enter"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <Card
              className="h-full bg-card/40 hover:bg-card/60 cursor-pointer transition-all hover:shadow-md group opacity-70 hover:opacity-100"
              onClick={() => navigate(projectPath(project.alias))}
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
                      unarchive.mutate(project.id)
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07] transition-colors"
                    aria-label={t('project.unarchive')}
                    title={t('project.unarchive')}
                    disabled={unarchive.isPending}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="mt-auto">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {project.directory && (
                    <span className="flex min-w-0 items-center gap-1">
                      <FolderOpen className="h-3 w-3 shrink-0" />
                      <span className="truncate font-mono">{project.directory}</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
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

              {/* Cron */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  void navigate('/cron')
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Clock className="h-4.5 w-4.5 text-muted-foreground" />
                {t('cron.title')}
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
        onClick={() => navigate('/cron')}
        aria-label={t('cron.title')}
        title={t('cron.title')}
      >
        <Clock className="h-4 w-4" />
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
  const globalProjectPath = useViewModeStore(s => s.projectPath)
  const sortProject = useSortProject()

  // Keep refs for monitor callback access
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const sortProjectRef = useRef(sortProject)
  sortProjectRef.current = sortProject

  // Monitor for project card drops
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'project',
      onDrop: ({ source, location }) => {
        const targets = location.current.dropTargets
        const cardTarget = targets.find((t: any) => t.data.type === 'project')
        if (!cardTarget) return

        const list = projectsRef.current
        if (!list) return

        const draggedId = source.data.projectId as string
        const fromIndex = list.findIndex(p => p.id === draggedId)
        if (fromIndex === -1) return

        let toIndex = cardTarget.data.index as number
        const edge = extractClosestEdge(cardTarget.data)
        if (edge === 'right') toIndex += 1
        // Adjust for same-list downward movement
        if (fromIndex < toIndex) toIndex -= 1
        if (fromIndex === toIndex) return

        // Compute fractional sort order from the reordered list
        const reordered = [...list]
        const [moved] = reordered.splice(fromIndex, 1)
        if (!moved) return
        reordered.splice(toIndex, 0, moved)

        const newIdx = reordered.findIndex(p => p.id === draggedId)
        const prevKey = newIdx > 0 ? (reordered[newIdx - 1]!.sortOrder || null) : null
        const nextKey = newIdx < reordered.length - 1 ? (reordered[newIdx + 1]!.sortOrder || null) : null

        // Happy path: neighbors are in proper order
        if (prevKey === null || nextKey === null || prevKey < nextKey) {
          const newKey = generateKeyBetween(prevKey, nextKey)
          sortProjectRef.current.mutate({ id: draggedId, sortOrder: newKey })
        } else {
          // Collision: reassign all projects with sequential sort orders
          let cursor: string | null = null
          for (const project of reordered) {
            const key = generateKeyBetween(cursor, null)
            cursor = key
            sortProjectRef.current.mutate({ id: project.id, sortOrder: key })
          }
        }
      },
    })
  }, [])

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
          {projects ?
              (
                <Badge variant="secondary" className="ml-1">
                  {projects.length}
                </Badge>
              ) :
            null}

          {/* Mobile: right-side menu sheet */}
          {isMobile ?
              (
                <div className="ml-auto">
                  <MobileHomeMenu
                    onCreateProject={() => setShowCreate(true)}
                    onOpenSettings={() => setShowSettings(true)}
                  />
                </div>
              ) :
              (
                <DesktopHeaderControls
                  onCreateProject={() => setShowCreate(true)}
                  onOpenSettings={() => setShowSettings(true)}
                />
              )}
        </div>

        {isLoading ?
            (
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
            ) :
            (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects?.map((project, index) => (
                  <SortableProjectCard
                    key={project.id}
                    project={project}
                    index={index}
                    onClick={() => navigate(projectPath(project.alias))}
                  />
                ))}
              </div>
            )}

        <ArchivedProjectsSection projectPath={projectPath} />
      </section>

      <CreateProjectDialog open={showCreate} onOpenChange={setShowCreate} />
      <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </main>
  )
}
