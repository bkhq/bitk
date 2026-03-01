import { ArrowLeft, Check, Link, Plus, Sparkles } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAutoTitleIssue, useIssue, useUpdateIssue } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { ChatBody } from './ChatBody'
import { SubIssueDialog } from './SubIssueDialog'

const LazyDiffPanel = lazy(() =>
  import('./DiffPanel').then((m) => ({ default: m.DiffPanel })),
)

export function ChatArea({
  projectId,
  issueId,
  showDiff,
  diffWidth,
  onToggleDiff,
  onDiffWidthChange,
  onCloseDiff,
  showBackToList,
}: {
  projectId: string
  issueId: string
  showDiff: boolean
  diffWidth: number
  onToggleDiff: () => void
  onDiffWidthChange: (w: number) => void
  onCloseDiff: () => void
  showBackToList?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(projectId, issueId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showSubIssue, setShowSubIssue] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const isMobile = useIsMobile()
  const updateIssue = useUpdateIssue(projectId)
  const autoTitle = useAutoTitleIssue(projectId)
  const [isAutoTitling, setIsAutoTitling] = useState(false)
  const titleBeforeAutoRef = useRef<string | null>(null)

  // Detect title change to clear auto-titling state
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (isAutoTitling && titleBeforeAutoRef.current !== null && issue) {
      if (issue.title !== titleBeforeAutoRef.current) {
        setIsAutoTitling(false)
        titleBeforeAutoRef.current = null
      }
    }
  }, [isAutoTitling, issue?.title])

  // Reset auto-titling when session fails
  useEffect(() => {
    if (isAutoTitling && issue?.sessionStatus === 'failed') {
      setIsAutoTitling(false)
      titleBeforeAutoRef.current = null
    }
  }, [isAutoTitling, issue?.sessionStatus])

  // Safety timeout — clear auto-titling after 30s
  useEffect(() => {
    if (!isAutoTitling) return
    const timer = setTimeout(() => {
      setIsAutoTitling(false)
      titleBeforeAutoRef.current = null
    }, 30_000)
    return () => clearTimeout(timer)
  }, [isAutoTitling])

  const handleAutoTitle = useCallback(() => {
    if (!issue) return
    titleBeforeAutoRef.current = issue.title
    setIsAutoTitling(true)
    autoTitle.mutate(issueId, {
      onError: () => {
        setIsAutoTitling(false)
        titleBeforeAutoRef.current = null
      },
    })
  }, [issue, autoTitle, issueId])

  const saveTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== issue?.title) {
      updateIssue.mutate({ id: issueId, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, issue?.title, updateIssue, issueId])

  const startEditingTitle = useCallback(() => {
    if (issue) {
      setTitleDraft(issue.title)
      setEditingTitle(true)
    }
  }, [issue])

  const handleAfterDelete = useCallback(() => {
    void navigate(
      showBackToList
        ? `/projects/${projectId}/issues`
        : `/projects/${projectId}`,
    )
  }, [navigate, showBackToList, projectId])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (isError || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">{t('issue.notFound')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('issue.backToBoard')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-w-0 bg-background overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] md:gap-2.5 md:px-3 bg-background/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            onClick={() =>
              showBackToList
                ? navigate(`/projects/${projectId}/issues`)
                : navigate(`/projects/${projectId}`)
            }
            title={
              showBackToList ? t('issue.backToList') : t('issue.backToBoard')
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                #{issue.issueNumber}
              </span>
              {editingTitle ? (
                <input
                  className="text-sm font-semibold bg-transparent border-b-2 border-primary outline-none min-w-0 flex-1 tracking-tight"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveTitle()
                    } else if (e.key === 'Escape') {
                      setEditingTitle(false)
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors duration-200 tracking-tight decoration-primary/30 hover:underline underline-offset-2"
                  onClick={startEditingTitle}
                  title={t('issue.editTitle')}
                >
                  {issue.title}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 shrink-0 transition-colors ${
              isAutoTitling
                ? 'text-violet-600 dark:text-violet-400 animate-pulse'
                : issue.sessionStatus
                  ? 'text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400'
                  : 'text-muted-foreground/30 cursor-not-allowed'
            }`}
            title={t('issue.autoTitle')}
            disabled={!issue.sessionStatus || isAutoTitling}
            onClick={handleAutoTitle}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
          {!issue.parentIssueId ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title={t('issue.createSubIssue')}
              onClick={() => setShowSubIssue(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 shrink-0 transition-all duration-200 ${copied ? 'text-emerald-500 scale-110' : 'text-muted-foreground hover:text-foreground'}`}
            title={t('issue.copyLink')}
            onClick={() => {
              const url = `${window.location.origin}/projects/${projectId}/issues/${issueId}`
              navigator.clipboard
                .writeText(url)
                .then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
                .catch(() => {})
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Link className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Shared chat body: messages + metadata bar + input */}
        <ChatBody
          projectId={projectId}
          issueId={issueId}
          issue={issue}
          showDiff={showDiff}
          onToggleDiff={onToggleDiff}
          scrollRef={scrollRef}
          onAfterDelete={handleAfterDelete}
        />
      </div>

      {/* Diff panel — full-screen overlay on mobile, inline on desktop */}
      {showDiff ? (
        isMobile ? (
          <div className="fixed inset-0 z-40 bg-background flex flex-col">
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  {t('common.loading')}
                </div>
              }
            >
              <LazyDiffPanel
                projectId={projectId}
                issueId={issueId}
                width={0}
                onWidthChange={onDiffWidthChange}
                onClose={onCloseDiff}
                fullScreen
              />
            </Suspense>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex w-[360px] shrink-0 items-center justify-center border-l border-border bg-background text-sm text-muted-foreground">
                {t('common.loading')}
              </div>
            }
          >
            <LazyDiffPanel
              projectId={projectId}
              issueId={issueId}
              width={diffWidth}
              onWidthChange={onDiffWidthChange}
              onClose={onCloseDiff}
            />
          </Suspense>
        )
      ) : null}

      {/* Sub-issue dialog */}
      <SubIssueDialog
        projectId={projectId}
        parentIssueId={issueId}
        open={showSubIssue}
        onOpenChange={setShowSubIssue}
      />
    </div>
  )
}
