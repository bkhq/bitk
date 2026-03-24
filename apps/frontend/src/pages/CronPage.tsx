import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  StickyNote,
  TerminalSquare,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCronJobs } from '@/hooks/use-kanban'
import type { CronJob, CronJobLog, CronJobLogsResponse } from '@/lib/kanban-api'
import { kanbanApi } from '@/lib/kanban-api'
import { useNotesStore } from '@/stores/notes-store'
import { useTerminalStore } from '@/stores/terminal-store'

const LOG_PAGE_SIZE = 20

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
}

function formatTime(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts)
  return d.toLocaleString()
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  switch (status) {
    case 'success':
    case 'running':
    case 'stopped':
      return (
        <Badge
          variant="secondary"
          className={
            status === 'success' ? 'bg-green-500/10 text-green-600' :
              status === 'running' ? 'bg-blue-500/10 text-blue-600' :
                'bg-muted text-muted-foreground'
          }
        >
          {status === 'success' && <CheckCircle2 className="mr-1 h-3 w-3" />}
          {status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {t(`cron.${status}`, status)}
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="secondary" className="bg-red-500/10 text-red-600">
          <XCircle className="mr-1 h-3 w-3" />
          {t('cron.failed')}
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary">{status}</Badge>
      )
  }
}

/* -- Job list view ---------------------------------------- */

function CronJobList({
  jobs,
  onSelectJob,
  isDeletedView,
}: {
  jobs: CronJob[]
  onSelectJob: (job: CronJob) => void
  isDeletedView?: boolean
}) {
  const { t } = useTranslation()

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Calendar className="mx-auto h-10 w-10 mb-3 opacity-40" />
        <p>{t('cron.noJobs')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job, index) => (
        <div
          key={job.id}
          className="animate-card-enter"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <Card
            className={`h-full cursor-pointer transition-all hover:shadow-md group ${isDeletedView ? 'bg-card/40 opacity-70 hover:opacity-100 hover:bg-card/60' : 'bg-card/70 hover:bg-card hover:border-primary/20'}`}
            onClick={() => onSelectJob(job)}
          >
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium transition-colors truncate ${isDeletedView ? 'line-through text-muted-foreground group-hover:text-foreground' : 'group-hover:text-primary'}`}>
                    {job.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {job.cron}
                  </p>
                </div>
                {isDeletedView
                  ? (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px]">
                        <Trash2 className="mr-0.5 h-2.5 w-2.5" />
                        {t('cron.deleted')}
                      </Badge>
                    )
                  : <StatusBadge status={job.enabled ? job.status : 'disabled'} />}
              </div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                {!isDeletedView && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5 shrink-0" />
                    <span className="ml-auto font-mono truncate">
                      {job.nextExecution ? formatTime(job.nextExecution) : '-'}
                    </span>
                  </div>
                )}
                {job.lastRun && (
                  <div className="flex items-center gap-1">
                    <Timer className="h-2.5 w-2.5 shrink-0" />
                    <span className="ml-auto flex items-center gap-1">
                      <StatusBadge status={job.lastRun.status} />
                      <span className="font-mono">{formatDuration(job.lastRun.durationMs)}</span>
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}

/* -- Task config as collapsible JSON ---------------------- */

function TaskConfigView({ config }: { config: Record<string, unknown> }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(config)
  if (entries.length === 0) return null

  const jsonStr = JSON.stringify(config, null, 2)

  return (
    <div className="mt-3 mb-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {t('cron.taskConfig')}
        <span className="text-[10px] opacity-60">
          (
          {entries.length}
          )
        </span>
      </button>
      {expanded && (
        <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all bg-muted/30 rounded px-3 py-2">
          {jsonStr}
        </pre>
      )}
    </div>
  )
}

/* -- Log detail view with pagination ---------------------- */

function CronJobLogView({ job, onBack }: { job: CronJob, onBack: () => void }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<CronJobLog[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const fetchLogs = useCallback(async (cursor?: string) => {
    const data = await kanbanApi.getCronJobLogs(job.id, {
      limit: LOG_PAGE_SIZE,
      cursor,
    }) as CronJobLogsResponse
    return data
  }, [job.id])

  // Initial load
  const [initialized, setInitialized] = useState(false)
  if (!initialized) {
    setInitialized(true)
    fetchLogs().then((data) => {
      setLogs(data.logs)
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const data = await fetchLogs(nextCursor)
      setLogs(prev => [...prev, ...data.logs])
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextCursor, isLoadingMore, fetchLogs])

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('cron.backToJobs')}
      </button>

      <div className="mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{job.name}</h2>
          {job.isDeleted && (
            <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px]">
              <Trash2 className="mr-0.5 h-2.5 w-2.5" />
              {t('cron.deleted')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{job.cron}</span>
          {!job.isDeleted && <StatusBadge status={job.enabled ? job.status : 'disabled'} />}
          {job.nextExecution && !job.isDeleted && (
            <span className="text-[11px]">
              {t('cron.nextExecution')}
              :
              {' '}
              {formatTime(job.nextExecution)}
            </span>
          )}
        </div>
      </div>

      <TaskConfigView config={job.taskConfig} />

      <h3 className="text-xs font-medium text-muted-foreground mb-2">
        {t('cron.logs')}
        {logs.length > 0 && (
          <span className="ml-1.5 opacity-60">
            {logs.length}
            {hasMore ? '+' : ''}
          </span>
        )}
      </h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-xs">
          <p>{t('cron.noLogs')}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log: CronJobLog) => (
            <LogEntry key={log.id} log={log} />
          ))}
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="text-muted-foreground h-7 text-xs"
              >
                {isLoadingMore
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <ChevronDown className="mr-1 h-3 w-3" />}
                {t('cron.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* -- Single log entry (collapsed by default) -------------- */

function LogEntry({ log }: { log: CronJobLog }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!(log.result || log.error)

  return (
    <div
      className={`rounded-md border bg-card/50 px-3 py-2 ${hasDetail ? 'cursor-pointer hover:bg-card/70' : ''}`}
      onClick={() => hasDetail && setExpanded(!expanded)}
      onKeyDown={hasDetail
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setExpanded(!expanded)
            }
          }
        : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      role={hasDetail ? 'button' : undefined}
      aria-expanded={hasDetail ? expanded : undefined}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={log.status} />
        <span className="text-[11px] text-muted-foreground font-mono">
          {formatTime(log.startedAt)}
        </span>
        {log.durationMs !== null && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {formatDuration(log.durationMs)}
          </span>
        )}
        {hasDetail && (
          <ChevronRight className={`ml-auto h-3 w-3 text-muted-foreground/50 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {log.result && (
            <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all bg-muted/30 rounded px-2 py-1.5">
              {log.result}
            </pre>
          )}
          {log.error && (
            <pre className="text-[11px] font-mono text-red-500 whitespace-pre-wrap break-all bg-red-500/5 rounded px-2 py-1.5">
              {log.error}
            </pre>
          )}
          {log.finishedAt && (
            <p className="text-[10px] text-muted-foreground/60">
              {formatTime(log.startedAt)}
              {' → '}
              {formatTime(log.finishedAt)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* -- Main page -------------------------------------------- */

export default function CronPage() {
  const { t } = useTranslation()
  const { data: jobs, isLoading } = useCronJobs()
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  const activeJobs = jobs?.filter(j => !j.isDeleted) ?? []
  const deletedJobs = jobs?.filter(j => j.isDeleted) ?? []

  return (
    <main className="min-h-screen text-foreground animate-page-enter">
      <section className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-8">
        {/* Header */}
        <div className="mb-4 flex items-center gap-2.5 md:mb-6">
          <Link to="/" aria-label={t('sidebar.home')}>
            <AppLogo className="h-8 w-8" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">
            {t('cron.title')}
          </h1>
          {jobs && (
            <Badge variant="secondary" className="ml-1">
              {activeJobs.length}
              {deletedJobs.length > 0 && (
                <span className="text-muted-foreground/60 ml-0.5">
                  +
                  {deletedJobs.length}
                </span>
              )}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
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
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card/30 animate-pulse p-4 space-y-2">
                <div className="h-3.5 w-24 rounded bg-muted" />
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-3 w-40 rounded bg-muted mt-3" />
              </div>
            ))}
          </div>
        ) : selectedJob ? (
          <CronJobLogView
            key={selectedJob.id}
            job={selectedJob}
            onBack={() => setSelectedJob(null)}
          />
        ) : (
          <>
            <CronJobList
              jobs={activeJobs}
              onSelectJob={setSelectedJob}
            />
            {deletedJobs.length > 0 && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setShowDeleted(!showDeleted)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDeleted ? 'rotate-90' : ''}`} />
                  <Trash2 className="h-3 w-3" />
                  {t('cron.deletedJobs')}
                  <span className="ml-1 opacity-60">
                    (
                    {deletedJobs.length}
                    )
                  </span>
                </button>
                {showDeleted && (
                  <CronJobList
                    jobs={deletedJobs}
                    onSelectJob={setSelectedJob}
                    isDeletedView
                  />
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
