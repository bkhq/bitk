import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  Loader2,
  RotateCcw,
  Skull,
  Square,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCancelIssue, useRestartIssue, useTerminateProcess } from '@/hooks/use-kanban'
import type { ProcessInfo } from '@/types/kanban'

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'running':
    case 'spawning':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    case 'pending':
      return <Clock className="h-3.5 w-3.5 text-yellow-500" />
    case 'completed':
      return <CircleCheck className="h-3.5 w-3.5 text-green-500" />
    case 'failed':
      return <CircleAlert className="h-3.5 w-3.5 text-destructive" />
    case 'cancelled':
      return <CircleX className="h-3.5 w-3.5 text-muted-foreground" />
    default:
      return <CirclePause className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function statusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running':
    case 'spawning':
      return 'default'
    case 'pending':
      return 'secondary'
    case 'failed':
      return 'destructive'
    default:
      return 'outline'
  }
}

function formatDuration(timestamp: string | null): string {
  if (!timestamp) return ''
  const diff = Date.now() - new Date(timestamp).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function isIdle(proc: ProcessInfo): boolean {
  return !proc.turnInFlight && !!proc.lastIdleAt
}

function ProcessCard({ proc, projectId }: { proc: ProcessInfo, projectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cancelMutation = useCancelIssue(projectId)
  const restartMutation = useRestartIssue(projectId)
  const terminateMutation = useTerminateProcess(projectId)
  const [showCommand, setShowCommand] = useState(false)
  const idle = isIdle(proc)

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* Title row */}
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon status={proc.processState} />
        <button
          type="button"
          className="text-xs font-medium text-foreground truncate hover:underline cursor-pointer text-left min-w-0"
          onClick={() => navigate(`/projects/${projectId}/issues/${proc.issueId}`)}
        >
          <span className="text-muted-foreground">
            #
            {proc.issueNumber}
          </span>
          {' '}
          {proc.issueTitle}
        </button>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {proc.processState && (
          <Badge variant={statusVariant(proc.processState)} className="text-[10px] px-1.5 py-0">
            {t(`session.status.${proc.processState}`)}
          </Badge>
        )}
        {idle && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600">
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            {t('processManager.idle')}
            {' '}
            {formatDuration(proc.lastIdleAt)}
          </Badge>
        )}
        {proc.engineType && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {proc.engineType}
          </Badge>
        )}
        {proc.model && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {proc.model}
          </Badge>
        )}
        {proc.pid != null && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
            PID
            {' '}
            {proc.pid}
          </Badge>
        )}
        {proc.turnInFlight && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            <Activity className="h-2.5 w-2.5 mr-0.5" />
            {t('processManager.turnInFlight')}
          </Badge>
        )}
        {proc.startedAt && (
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
            {formatDuration(proc.startedAt)}
          </span>
        )}
      </div>

      {/* Spawn command (collapsible) */}
      {proc.spawnCommand && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => setShowCommand(v => !v)}
          >
            {showCommand
              ? (
                  <ChevronDown className="h-3 w-3" />
                )
              : (
                  <ChevronRight className="h-3 w-3" />
                )}
            <Terminal className="h-3 w-3" />
            {t('processManager.command')}
          </button>
          {showCommand && (
            <pre className="mt-1 text-[10px] text-muted-foreground bg-muted rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all">
              {proc.spawnCommand}
            </pre>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1">
        {(proc.processState === 'running' || proc.processState === 'spawning') && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate(proc.issueId)}
          >
            <Square className="h-3 w-3" />
            {cancelMutation.isPending ? t('processManager.cancelling') : t('processManager.cancel')}
          </Button>
        )}
        {(proc.processState === 'failed' || proc.processState === 'cancelled') && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1"
            disabled={restartMutation.isPending}
            onClick={() => restartMutation.mutate(proc.issueId)}
          >
            <RotateCcw className="h-3 w-3" />
            {restartMutation.isPending
              ? t('processManager.restarting')
              : t('processManager.restart')}
          </Button>
        )}
        {/* Terminate — always available, force-kills process regardless of state */}
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] gap-1 text-destructive hover:text-destructive"
          disabled={terminateMutation.isPending}
          onClick={() => terminateMutation.mutate(proc.issueId)}
        >
          <Skull className="h-3 w-3" />
          {terminateMutation.isPending
            ? t('processManager.terminating')
            : t('processManager.terminate')}
        </Button>
      </div>
    </div>
  )
}

export function ProcessList({
  processes,
  projectId,
}: {
  processes: ProcessInfo[]
  projectId: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {processes.map(proc => (
        <ProcessCard key={proc.issueId} proc={proc} projectId={projectId} />
      ))}
    </div>
  )
}
