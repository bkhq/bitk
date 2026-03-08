import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { DIFF_MIN_WIDTH } from '@/components/issue-detail/diff-constants'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_DIFF_WIDTH = 360
const DEFAULT_LIST_WIDTH = 232
const MIN_LIST_WIDTH = 180
const MAX_LIST_WIDTH = 400

export default function ReviewPage() {
  const { t } = useTranslation()
  const { projectAlias = '', issueId = '' } = useParams<{
    projectAlias: string
    issueId: string
  }>()

  const { data: reviewIssues } = useReviewIssues()

  // Find the matching issue to get its projectId (alias)
  const activeIssue = reviewIssues?.find((i) => i.id === issueId)
  const projectId = activeIssue?.projectAlias ?? projectAlias

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

  useEffect(() => {
    if (!showDiff) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(
      MAX_LIST_WIDTH,
      viewport - SIDEBAR_WIDTH - diffWidth - MIN_CHAT_WIDTH,
    )
    setListWidth((prev) => Math.max(MIN_LIST_WIDTH, Math.min(prev, maxList)))
  }, [showDiff, diffWidth])

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}

      {!hideListPanel ? (
        <ReviewListPanel
          activeIssueId={issueId}
          width={isMobile ? undefined : listWidth}
          onResizeStart={isMobile ? undefined : handleListResizeStart}
          mobileNav={
            isMobile ? <MobileSidebar activeProjectId="" /> : undefined
          }
        />
      ) : null}

      {issueId && projectId ? (
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
            {t('review.selectToStart')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
