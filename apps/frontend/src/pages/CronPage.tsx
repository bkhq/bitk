import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  StickyNote,
  TerminalSquare,
  Timer,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCronJobLogs, useCronJobs } from '@/hooks/use-kanban'
import type { CronJob, CronJobLog } from '@/lib/kanban-api'
import { useNotesStore } from '@/stores/notes-store'
import { useTerminalStore } from '@/stores/terminal-store'

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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <CardTitle className={`text-base transition-colors truncate ${isDeletedView ? 'line-through text-muted-foreground group-hover:text-foreground' : 'group-hover:text-primary'}`}>
                    {job.name}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground font-mono">
                    {job.cron}
                  </p>
                </div>
                {isDeletedView
                  ? (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t('cron.deleted')}
                      </Badge>
                    )
                  : <StatusBadge status={job.enabled ? job.status : 'disabled'} />}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {!isDeletedView && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>
                      {t('cron.nextExecution')}
                      :
                    </span>
                    <span className="ml-auto font-mono truncate">
                      {job.nextExecution ? formatTime(job.nextExecution) : '-'}
                    </span>
                  </div>
                )}
                {job.lastRun && (
                  <div className="flex items-center gap-1.5">
                    <Timer className="h-3 w-3 shrink-0" />
                    <span>
                      {t('cron.lastRun')}
                      :
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <StatusBadge status={job.lastRun.status} />
                      <span className="font-mono">{formatDuration(job.lastRun.durationMs)}</span>
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {job.taskType}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}

/* -- Log list view ---------------------------------------- */

function TaskConfigView({ config }: { config: Record<string, unknown> }) {
  const { t } = useTranslation()
  const entries = Object.entries(config)
  if (entries.length === 0) return null

  return (
    <div className="mt-4 mb-6">
      <h3 className="text-sm font-medium mb-2">{t('cron.taskConfig')}</h3>
      <Card className="bg-muted/30">
        <CardContent className="py-3 px-4">
          <div className="space-y-1.5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-muted-foreground shrink-0">
                  {key}
                  :
                </span>
                <span className="font-mono break-all">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CronJobLogView({ job, onBack }: { job: CronJob, onBack: () => void }) {
  const { t } = useTranslation()
  const { data, isLoading } = useCronJobLogs(job.id)

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('cron.backToJobs')}
      </button>

      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{job.name}</h2>
          {job.isDeleted && (
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              <Trash2 className="mr-1 h-3 w-3" />
              {t('cron.deleted')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{job.cron}</span>
          {!job.isDeleted && <StatusBadge status={job.enabled ? job.status : 'disabled'} />}
          {job.nextExecution && !job.isDeleted && (
            <span className="text-xs">
              {t('cron.nextExecution')}
              :
              {formatTime(job.nextExecution)}
            </span>
          )}
        </div>
      </div>

      <TaskConfigView config={job.taskConfig} />

      <h3 className="text-sm font-medium mb-3">{t('cron.logs')}</h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.logs.length ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>{t('cron.noLogs')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.logs.map((log: CronJobLog) => (
            <LogEntry key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  )
}

function LogEntry({ log }: { log: CronJobLog }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !!(log.result || log.error)

  return (
    <Card
      className={`bg-card/50 ${hasDetail ? 'cursor-pointer' : ''}`}
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
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={log.status} />
          <span className="text-xs text-muted-foreground font-mono">
            {formatTime(log.startedAt)}
          </span>
          {log.finishedAt && (
            <span className="text-xs text-muted-foreground">
              →
              {' '}
              {formatTime(log.finishedAt)}
            </span>
          )}
          {log.durationMs !== null && (
            <span className="text-xs text-muted-foreground">
              {t('cron.duration')}
              :
              {formatDuration(log.durationMs)}
            </span>
          )}
          {hasDetail && (
            <ChevronRight className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </div>
        {!expanded && log.result && (
          <p className="mt-1.5 text-xs text-muted-foreground font-mono truncate">
            {log.result}
          </p>
        )}
        {!expanded && log.error && (
          <p className="mt-1.5 text-xs text-red-500 font-mono truncate">
            {log.error}
          </p>
        )}
        {expanded && (
          <div className="mt-3 space-y-2">
            {log.result && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mb-1">{t('cron.result')}</p>
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all bg-muted/40 rounded px-2.5 py-2">
                  {log.result}
                </pre>
              </div>
            )}
            {log.error && (
              <div>
                <p className="text-[10px] font-medium text-red-500 mb-1">{t('cron.error')}</p>
                <pre className="text-xs font-mono text-red-500 whitespace-pre-wrap break-all bg-red-500/5 rounded px-2.5 py-2">
                  {log.error}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
      <section className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-12">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3 md:mb-8">
          <Link to="/" aria-label={t('sidebar.home')}>
            <AppLogo className="h-9 w-9" />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-card/30 animate-pulse min-h-[120px]">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 rounded bg-muted" />
                      <div className="h-3 w-32 rounded bg-muted" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-3 w-40 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : selectedJob ? (
          <CronJobLogView
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
              <div className="mt-8">
                <button
                  type="button"
                  onClick={() => setShowDeleted(!showDeleted)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${showDeleted ? 'rotate-90' : ''}`} />
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('cron.deletedJobs')}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {deletedJobs.length}
                  </Badge>
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
