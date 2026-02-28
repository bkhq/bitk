import { useRef } from 'react'
import { Minus, Maximize2, Minimize2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useTerminalStore,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT_RATIO,
} from '@/stores/terminal-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { TerminalView, disposeTerminal } from './TerminalView'

export function TerminalDrawer() {
  const { t } = useTranslation()
  const {
    isOpen,
    isFullscreen,
    height,
    close,
    minimize,
    toggleFullscreen,
    setHeight,
  } = useTerminalStore()
  const isMobile = useIsMobile()
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  if (!isOpen) return null

  const viewportHeight =
    typeof window === 'undefined' ? 600 : window.innerHeight
  const maxHeight = Math.round(viewportHeight * TERMINAL_MAX_HEIGHT_RATIO)
  // Mobile always fullscreen
  const fullscreen = isMobile || isFullscreen
  const effectiveHeight = fullscreen ? viewportHeight : height

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 flex flex-col border-t border-border bg-[#1a1a2e] shadow-2xl ${
        fullscreen ? 'top-0' : ''
      }`}
      style={fullscreen ? undefined : { height: effectiveHeight }}
    >
      {/* Resize handle — hidden in fullscreen and on mobile */}
      {!fullscreen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('terminal.resizePanel')}
          aria-valuenow={height}
          aria-valuemin={TERMINAL_MIN_HEIGHT}
          aria-valuemax={maxHeight}
          tabIndex={0}
          className="absolute top-0 left-0 right-0 h-2 -translate-y-1/2 z-10 cursor-row-resize group select-none outline-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { startY: e.clientY, startHeight: height }
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return
            const dy = dragRef.current.startY - e.clientY
            setHeight(dragRef.current.startHeight + dy)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 50 : 10
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHeight(height + step)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHeight(height - step)
            }
          }}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
        <span className="text-xs font-medium text-white/70">
          {t('terminal.title')}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={minimize}
            className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            aria-label={t('terminal.minimize')}
            title={t('terminal.minimize')}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {!isMobile && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
              aria-label={t('terminal.maximize')}
              title={isFullscreen ? t('terminal.back') : t('terminal.maximize')}
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
            className="p-1 rounded text-white/50 hover:text-red-400 hover:bg-white/10 transition-colors"
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
  )
}
