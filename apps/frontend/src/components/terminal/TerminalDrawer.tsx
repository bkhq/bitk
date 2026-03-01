import {
  Maximize2,
  Minimize2,
  Minus,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  TERMINAL_MAX_WIDTH_RATIO,
  TERMINAL_MIN_WIDTH,
  useTerminalStore,
} from '@/stores/terminal-store'
import { disposeTerminal, TerminalView } from './TerminalView'

export function TerminalDrawer() {
  const { t } = useTranslation()
  const {
    isOpen,
    isFullscreen,
    width,
    close,
    minimize,
    toggleFullscreen,
    setWidth,
  } = useTerminalStore()
  const isMobile = useIsMobile()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  if (!isOpen) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * TERMINAL_MAX_WIDTH_RATIO)
  const fullscreen = isMobile || isFullscreen

  return (
    <>
      {/* Backdrop overlay */}
      {fullscreen ? null : (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[39] bg-black/20"
          onClick={close}
        />
      )}
      <div
        className={`fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl ${
          fullscreen ? 'left-0' : ''
        }`}
        style={fullscreen ? undefined : { width }}
      >
        {/* Resize handle — hidden in fullscreen and on mobile */}
        {!fullscreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('terminal.resizePanel')}
            aria-valuenow={width}
            aria-valuemin={TERMINAL_MIN_WIDTH}
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
            onPointerCancel={() => {
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
            <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground truncate">
              {t('terminal.title')}
            </span>
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
                title={
                  isFullscreen ? t('terminal.back') : t('terminal.maximize')
                }
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                disposeTerminal()
                close()
              }}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
              aria-label={t('terminal.kill')}
              title={t('terminal.kill')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal */}
        <TerminalView className="flex-1 min-h-0 p-1" />
      </div>
    </>
  )
}
