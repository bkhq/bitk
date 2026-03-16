import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { useSharedIssue } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'

export default function SharedIssuePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams<{ token: string }>()

  const { data: issue, isLoading, isError } = useSharedIssue(token)

  const [showDiff, setShowDiff] = useState(false)
  const [diffWidth, setDiffWidth] = useState(360)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(360)

  // Create a log fetcher that uses the share token API
  const logFetcher = useMemo(
    () => (opts?: { before?: string, cursor?: string, limit?: number }) =>
      kanbanApi.getSharedIssueLogs(token, opts),
    [token],
  )

  const handleDiffWidthChange = useCallback((w: number) => {
    setDiffWidth(Math.max(240, Math.min(w, 800)))
  }, [])

  const handleFileBrowserWidthChange = useCallback((w: number) => {
    setFileBrowserWidth(Math.max(240, Math.min(w, 800)))
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (isError || !issue) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{t('share.notFound')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden animate-page-enter">
      <ChatArea
        projectId={issue.projectId}
        issueId={issue.id}
        showDiff={showDiff}
        diffWidth={diffWidth}
        onToggleDiff={() => setShowDiff(v => !v)}
        onDiffWidthChange={handleDiffWidthChange}
        onCloseDiff={() => setShowDiff(false)}
        fileBrowserWidth={fileBrowserWidth}
        onFileBrowserWidthChange={handleFileBrowserWidthChange}
        readOnly
        sharedIssue={issue}
        logFetcher={logFetcher}
      />
    </div>
  )
}
