import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useIssueStream } from '@/hooks/use-issue-stream'
import {
  useCancelIssue,
  useDeleteIssue,
  useGlobalSlashCommands,
  useSlashCommands,
  useUpdateIssue,
} from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import { STATUS_MAP } from '@/lib/statuses'
import type { Issue, NormalizedLogEntry } from '@/types/kanban'
import { ChatInput } from './ChatInput'
import { IssueDetail } from './IssueDetail'

const LazySessionMessages = lazy(() =>
  import('./SessionMessages').then(m => ({ default: m.SessionMessages })),
)

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled'])

// ---------- shared session-state helpers ----------

function deriveWorkingStep(logs: NormalizedLogEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (entry.entryType !== 'tool-use') continue
    const md = entry.metadata
    if (!md || md.isResult === true || md.toolName !== 'TodoWrite') continue
    const input = md.input as { todos?: Array<Record<string, unknown>> } | undefined
    const todos = Array.isArray(input?.todos) ? input.todos : []
    if (todos.length === 0) continue
    const inProgress = todos.find(todo => todo.status === 'in_progress')
    const pending = todos.find(todo => todo.status === 'pending')
    const completed = todos.toReversed().find(todo => todo.status === 'completed')
    const current = inProgress ?? pending ?? completed ?? todos[0]
    const activeForm = typeof current.activeForm === 'string' ? current.activeForm : null
    const content = typeof current.content === 'string' ? current.content : null
    return activeForm ?? content ?? null
  }
  return null
}

// ---------- exported hook (for title bars that need isThinking) ----------

export function useSessionState(
  projectId: string,
  issueId: string | null,
  issue: Issue | null | undefined,
) {
  const hasSession = !!issue?.sessionStatus
  const isTodo = issue?.statusId === 'todo'
  const isDone = issue?.statusId === 'done'
  const streamEnabled = hasSession || isTodo || isDone

  const {
    logs,
    sessionStatus: streamStatus,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  } = useIssueStream({
    projectId,
    issueId: streamEnabled ? issueId : null,
    sessionStatus: issue?.sessionStatus ?? null,
    enabled: !!(issueId && streamEnabled),
  })

  // Merge SSE-derived status with React Query status for resilience.
  // If EITHER source reports a terminal state, stop thinking immediately.
  // SSE updates are instant; React Query may lag behind due to invalidation
  // + refetch cycles, but can also recover via window focus or staleTime.
  const streamIsTerminal = !!streamStatus && TERMINAL_STATUSES.has(streamStatus)
  const queryStatus = issue?.sessionStatus ?? null
  const effectiveStatus = streamIsTerminal ? streamStatus : queryStatus
  const isSessionActive = effectiveStatus === 'running' || effectiveStatus === 'pending'

  // When the session is active (running/pending), always show thinking.
  // Previously we used hasUnfinishedSegmentIn(logs) to detect mid-turn
  // completion, but this caused a false negative: when a new follow-up
  // starts, the old turnCompleted marker is still the last log entry,
  // making hasUnfinishedSegmentIn() return false for up to several seconds
  // while the process spawns.  The small trade-off (indicator lingers
  // ~200ms after a turn actually completes until DB status updates to
  // 'completed') is far better than the indicator not showing at all.
  const isThinking = isSessionActive

  const workingStep = deriveWorkingStep(logs)

  return {
    logs,
    isThinking,
    workingStep,
    isTodo,
    isDone,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  }
}

// ---------- ChatBody component ----------

export function ChatBody({
  projectId,
  issueId,
  issue,
  showDiff,
  onToggleDiff,
  scrollRef: externalScrollRef,
  onAfterDelete,
}: {
  projectId: string
  issueId: string
  issue: Issue
  showDiff: boolean
  onToggleDiff: () => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
  onAfterDelete?: () => void
}) {
  const { t } = useTranslation()
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalScrollRef ?? internalScrollRef

  const updateIssue = useUpdateIssue(projectId)
  const cancelIssue = useCancelIssue(projectId)
  const deleteIssueMutation = useDeleteIssue(projectId)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [pendingEditContent, setPendingEditContent] = useState<string | null>(null)

  const handleDelete = useCallback(() => {
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    deleteIssueMutation.mutate(issueId, {
      onSuccess: () => {
        setDeleteDialogOpen(false)
        onAfterDelete?.()
      },
    })
  }, [deleteIssueMutation, issueId, onAfterDelete])

  const hasSession = !!issue.sessionStatus
  const { data: globalCmds } = useGlobalSlashCommands(issue.engineType)
  const { data: liveCmds } = useSlashCommands(projectId, issueId, hasSession)
  const hasLive =
    (liveCmds?.commands?.length ?? 0) > 0 ||
    (liveCmds?.agents?.length ?? 0) > 0 ||
    (liveCmds?.plugins?.length ?? 0) > 0
  const activeCmds = hasLive ? liveCmds : globalCmds
  const slashCommands = activeCmds?.commands ?? []
  const agentCommands = activeCmds?.agents ?? []
  const pluginCommands = activeCmds?.plugins ?? []

  const {
    logs,
    isThinking,
    workingStep,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  } = useSessionState(projectId, issueId, issue)

  const handleEditPending = useCallback(async () => {
    try {
      const result = await kanbanApi.deletePendingMessage(projectId, issueId)
      setPendingEditContent(result.content)
      removeEntries([result.id])
    } catch {
      /* ignore — pending may have been consumed already */
    }
  }, [projectId, issueId, removeEntries])

  // Reset cancelling state when the session settles or a new turn starts.
  // Without the sessionStatus check, a follow-up that keeps isThinking=true
  // would leave isCancelling stuck, blocking the user from cancelling the new turn.
  const prevSessionStatusRef = useRef(issue.sessionStatus)
  useEffect(() => {
    const prev = prevSessionStatusRef.current
    prevSessionStatusRef.current = issue.sessionStatus
    if (!isCancelling) return
    // Session settled
    if (!isThinking) {
      setIsCancelling(false)
      return
    }
    // New turn started (e.g. follow-up reactivated while cancel was in progress)
    if (issue.sessionStatus === 'running' && prev !== 'running') {
      setIsCancelling(false)
    }
  }, [isCancelling, isThinking, issue.sessionStatus])

  // Show toast when execution transitions to failed
  const prevStatusRef = useRef(issue.sessionStatus)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = issue.sessionStatus
    if (issue.sessionStatus === 'failed' && prev != null && prev !== 'failed') {
      toast.error(t('session.executionFailed'))
    }
  }, [issue.sessionStatus, t])

  // Track scroll position for scroll-to-top / scroll-to-bottom buttons
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setShowScrollTop(scrollTop > 200)
      setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 200)
    }

    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollRef, logs.length])

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [scrollRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [scrollRef])

  return (
    <>
      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
          <div className="flex flex-col min-h-full justify-end py-2">
            <Suspense
              fallback={
                <div className="px-5 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
              }
            >
              <LazySessionMessages
                logs={logs}
                scrollRef={scrollRef}
                isRunning={isThinking}
                workingStep={workingStep}
                onCancel={() => {
                  setIsCancelling(true)
                  cancelIssue.mutate(issueId, {
                    onError: () => setIsCancelling(false),
                  })
                }}
                isCancelling={isCancelling}
                hasOlderLogs={hasOlderLogs}
                isLoadingOlder={isLoadingOlder}
                onLoadOlder={loadOlderLogs}
                onEditPending={handleEditPending}
              />
            </Suspense>
          </div>
        </div>

        {/* Scroll-to-top / scroll-to-bottom floating buttons */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
          {showScrollTop ?
              (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="rounded-full border border-border/50 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
                  title={t('session.scrollToTop')}
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </button>
              ) :
            null}
          {showScrollBottom ?
              (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="rounded-full border border-border/50 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
                  title={t('session.scrollToBottom')}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </button>
              ) :
            null}
        </div>
      </div>

      {/* Issue metadata bar — fixed above input */}
      <IssueDetail
        issue={issue}
        projectId={projectId}
        status={STATUS_MAP.get(issue.statusId)}
        onUpdate={fields => updateIssue.mutate({ id: issueId, ...fields })}
        onDelete={handleDelete}
        isDeleting={deleteIssueMutation.isPending}
      />

      {/* Input */}
      <ChatInput
        projectId={projectId}
        issueId={issueId}
        diffOpen={showDiff}
        onToggleDiff={onToggleDiff}
        scrollRef={scrollRef}
        engineType={issue.engineType ?? undefined}
        model={issue.model ?? undefined}
        sessionStatus={issue.sessionStatus}
        statusId={issue.statusId}
        isThinking={isThinking}
        slashCommands={slashCommands}
        agentCommands={agentCommands}
        pluginCommands={pluginCommands}
        onRefreshLogs={refreshLogs}
        onMessageSent={(messageId, prompt, metadata) => {
          appendServerMessage(messageId, prompt, metadata)
        }}
        pendingEditContent={pendingEditContent}
        onPendingEditConsumed={() => setPendingEditContent(null)}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('issue.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('issue.deleteConfirm')}</AlertDialogDescription>
            {issue.childCount && issue.childCount > 0 ?
                (
                  <AlertDialogDescription className="text-destructive">
                    {t('issue.deleteWithChildren')}
                  </AlertDialogDescription>
                ) :
              null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteIssueMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteIssueMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                handleConfirmDelete()
              }}
            >
              {deleteIssueMutation.isPending ? t('issue.deleting') : t('issue.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
