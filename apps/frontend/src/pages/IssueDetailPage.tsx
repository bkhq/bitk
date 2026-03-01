import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { DIFF_MIN_WIDTH } from '@/components/issue-detail/diff-constants'
import { IssueListPanel } from '@/components/issue-detail/IssueListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useProject } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_DIFF_WIDTH = 360
const DEFAULT_LIST_WIDTH = 232
const MIN_LIST_WIDTH = 180
const MAX_LIST_WIDTH = 400

export default function IssueDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default', issueId = '' } = useParams<{
    projectId: string
    issueId: string
  }>()

  const { data: project, isLoading, isError } = useProject(projectId)
  const [showDiff, setShowDiff] = useState(false)
  const [diffWidth, setDiffWidth] = useState(DEFAULT_DIFF_WIDTH)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const isResizingList = useRef(false)
  const isMobile = useIsMobile()

  const handleListResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizingList.current = true
      const startX = e.clientX
      const startWidth = listWidth

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizingList.current) return
        const delta = ev.clientX - startX
        // Dynamic max: ensure MIN_CHAT_WIDTH remains after sidebar + list + diff
        const viewport =
          typeof window !== 'undefined' ? window.innerWidth : 1600
        const diffSpace = showDiff ? diffWidth : 0
        const dynamicMax = Math.min(
          MAX_LIST_WIDTH,
          viewport - SIDEBAR_WIDTH - diffSpace - MIN_CHAT_WIDTH,
        )
        const newWidth = Math.min(
          dynamicMax,
          Math.max(MIN_LIST_WIDTH, startWidth + delta),
        )
        setListWidth(newWidth)
      }

      const onMouseUp = () => {
        isResizingList.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [listWidth, showDiff, diffWidth],
  )

  // On mobile: show list when no issue selected, show chat when issue selected
  // On desktop: hide list panel when diff panel needs more than 50% of available space
  const availableWidth =
    typeof window !== 'undefined' ? window.innerWidth - SIDEBAR_WIDTH : 1200
  const hideListPanel =
    (isMobile && !!issueId) || (showDiff && diffWidth > availableWidth * 0.5)

  const handleDiffWidthChange = useCallback(
    (w: number) => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const listSpace = hideListPanel ? 0 : listWidth
      const maxWidth = viewport - SIDEBAR_WIDTH - listSpace - MIN_CHAT_WIDTH
      setDiffWidth(Math.min(Math.max(DIFF_MIN_WIDTH, w), maxWidth))
    },
    [hideListPanel, listWidth],
  )

  // Clamp listWidth when diff panel opens or grows to preserve MIN_CHAT_WIDTH
  useEffect(() => {
    if (!showDiff) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(
      MAX_LIST_WIDTH,
      viewport - SIDEBAR_WIDTH - diffWidth - MIN_CHAT_WIDTH,
    )
    setListWidth((prev) => Math.max(MIN_LIST_WIDTH, Math.min(prev, maxList)))
  }, [showDiff, diffWidth])

  useEffect(() => {
    if (!isLoading && (isError || !project)) {
      void navigate('/', { replace: true })
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
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {/* Sidebar — hidden on mobile */}
      {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}

      {/* Issue list panel — hidden on mobile (replaced by full-page views) */}
      {!hideListPanel ? (
        <IssueListPanel
          projectId={projectId}
          activeIssueId={issueId}
          projectName={project.name}
          width={isMobile ? undefined : listWidth}
          onResizeStart={isMobile ? undefined : handleListResizeStart}
          mobileNav={
            isMobile ? <MobileSidebar activeProjectId={projectId} /> : undefined
          }
        />
      ) : null}

      {/* Chat area when issue is selected */}
      {issueId ? (
        <ChatArea
          projectId={projectId}
          issueId={issueId}
          showDiff={showDiff}
          diffWidth={diffWidth}
          onToggleDiff={() => setShowDiff((v) => !v)}
          onDiffWidthChange={handleDiffWidthChange}
          onCloseDiff={() => setShowDiff(false)}
          showBackToList
        />
      ) : !hideListPanel ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {t('issue.selectToStart')}
          </p>
        </div>
      ) : null}
      <CreateIssueDialog />
    </div>
  )
}
