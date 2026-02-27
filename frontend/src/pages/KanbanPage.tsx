import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProject, useIssues } from '@/hooks/use-kanban'
import { STATUSES, DEFAULT_STATUS_ID } from '@/lib/statuses'
import {
  usePanelStore,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH_RATIO,
} from '@/stores/panel-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { KanbanHeader } from '@/components/kanban/KanbanHeader'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { IssuePanel } from '@/components/kanban/IssuePanel'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'

export default function KanbanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default' } = useParams<{ projectId: string }>()
  const { data: project, isLoading, isError } = useProject(projectId)
  const { data: issues } = useIssues(projectId)

  const { panel, isPanelOpen, width, close, openView } = usePanelStore()
  const isMobile = useIsMobile()
  const [searchQuery, setSearchQuery] = useState('')

  const handleCardClick = useCallback(
    (issue: Parameters<typeof openView>[0]) => {
      if (isMobile) {
        navigate(`/projects/${projectId}/issues/${issue.id}`)
      } else {
        openView(issue)
      }
    },
    [isMobile, navigate, projectId, openView],
  )

  useEffect(() => {
    if (!isLoading && (isError || !project)) {
      navigate('/', { replace: true })
    }
  }, [isLoading, isError, project, navigate])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">
          {t('kanban.loadingProject')}
        </p>
      </div>
    )
  }

  if (isError || !project) {
    return null
  }

  return (
    <div className="flex h-full text-foreground animate-page-enter">
      {/* Left Sidebar — hidden on mobile */}
      {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}

      {/* Main Content — inert when panel is open on desktop */}
      <div
        className="flex flex-1 min-w-0 flex-col"
        {...(!isMobile && isPanelOpen ? { inert: true } : {})}
      >
        <KanbanHeader
          project={project}
          issueCount={issues?.length ?? 0}
          defaultStatusId={DEFAULT_STATUS_ID}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          mobileNav={
            isMobile ? <MobileSidebar activeProjectId={projectId} /> : undefined
          }
        />

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <KanbanBoard
              projectId={projectId}
              searchQuery={searchQuery}
              onCardClick={handleCardClick}
            />
          </div>
        </div>
      </div>

      {/* Overlay — covers entire page, click to close panel (desktop only) */}
      {!isMobile && isPanelOpen ? (
        <div className="fixed inset-0 z-20 bg-black/50" onClick={close} />
      ) : null}

      {/* Create Issue Dialog */}
      <CreateIssueDialog />

      {/* Issue Side Panel — desktop only; mobile navigates to detail page */}
      {!isMobile && isPanelOpen && panel.kind === 'view' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('kanban.issueDetails')}
          className="fixed inset-y-0 right-0 z-30 border-l border-border bg-card"
          style={{ width }}
        >
          <ResizeHandle />
          <IssuePanel
            projectId={projectId}
            issue={panel.issue}
            onClose={close}
          />
        </div>
      ) : null}
    </div>
  )
}

function ResizeHandle() {
  const { t } = useTranslation()
  const width = usePanelStore((s) => s.width)
  const setWidth = usePanelStore.getState().setWidth
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const maxWidth = Math.round(
    (typeof window === 'undefined' ? 800 : window.innerWidth) *
      PANEL_MAX_WIDTH_RATIO,
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('kanban.resizePanel')}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={maxWidth}
      tabIndex={0}
      className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-10 cursor-col-resize group select-none outline-none"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startX: e.clientX, startWidth: width }
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        const dx = dragRef.current.startX - e.clientX
        setWidth(dragRef.current.startWidth + dx)
      }}
      onPointerUp={() => {
        dragRef.current = null
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 50 : 10
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setWidth(width + step)
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setWidth(width - step)
        }
      }}
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 focus-visible:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
    </div>
  )
}
