import { Activity, Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject, useProjectProcesses } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  PROCESS_MANAGER_MAX_WIDTH_RATIO,
  PROCESS_MANAGER_MIN_WIDTH,
  useProcessManagerStore,
} from '@/stores/process-manager-store'
import { ProcessList } from './ProcessList'

export function ProcessManagerDrawer() {
  const { t } = useTranslation()
  const { isOpen, isFullscreen, width, projectId, close, minimize, toggleFullscreen, setWidth }
    = useProcessManagerStore()
  const isMobile = useIsMobile()
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null)

  const { data: project } = useProject(projectId ?? '')
  const { data, isLoading } = useProjectProcesses(projectId ?? '', !!projectId && isOpen)

  if (!isOpen || !projectId) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * PROCESS_MANAGER_MAX_WIDTH_RATIO)
  const fullscreen = isMobile || isFullscreen
  const effectiveWidth = fullscreen ? viewportWidth : width
  const processes = data?.processes ?? []

  return (
    <>
      {/* Backdrop overlay */}
      {fullscreen
        ? null
        : (
            <div className="fixed inset-0 z-[39] bg-black/20" onClick={close} onKeyDown={undefined} />
          )}
      <div
        className={`fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl ${
          fullscreen ? 'left-0' : ''
        }`}
        style={fullscreen ? undefined : { width: effectiveWidth }}
      >
        {/* Resize handle */}
        {!fullscreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('processManager.resizePanel')}
            aria-valuenow={width}
            aria-valuemin={PROCESS_MANAGER_MIN_WIDTH}
            aria-valuemax={maxWidth}
            tabIndex={0}
            className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2 z-10 cursor-col-resize group select-none outline-none"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
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
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground truncate">
              {project?.name ?? t('processManager.title')}
            </span>
            {processes.length > 0 && <Badge count={processes.length} />}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={minimize}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('terminal.minimize')}
              title={t('terminal.minimize')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {!isMobile && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t('terminal.maximize')}
                title={isFullscreen ? t('terminal.back') : t('terminal.maximize')}
              >
                {isFullscreen
                  ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    )
                  : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
              aria-label={t('processManager.close')}
              title={t('processManager.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto min-h-0 p-3">
          {isLoading
            ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )
            : processes.length === 0
              ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <Activity className="h-12 w-12" />
                    <p className="text-sm font-medium">{t('processManager.noProcesses')}</p>
                    <p className="text-xs text-center max-w-[240px]">
                      {t('processManager.noProcessesHint')}
                    </p>
                  </div>
                )
              : (
                  <ProcessList processes={processes} projectId={projectId} />
                )}
        </div>
      </div>
    </>
  )
}

function Badge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
      {count}
    </span>
  )
}
