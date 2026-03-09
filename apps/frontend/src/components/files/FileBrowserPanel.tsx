import { X } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FILE_BROWSER_MAX_WIDTH_RATIO, FILE_BROWSER_MIN_WIDTH } from '@/stores/file-browser-store'
import { FileBrowserContent } from './FileBrowserContent'

export function FileBrowserPanel({
  width,
  onWidthChange,
  onClose,
  fullScreen,
}: {
  width: number
  onWidthChange: (w: number) => void
  onClose: () => void
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null)
  const maxWidth = Math.round((typeof window === 'undefined' ? 800 : window.innerWidth) * FILE_BROWSER_MAX_WIDTH_RATIO)

  return (
    <div
      className={
        fullScreen
          ? 'flex flex-col flex-1 min-h-0 bg-background'
          : 'relative h-full shrink-0 border-l border-border bg-background'
      }
      style={fullScreen ? undefined : { width }}
    >
      {/* Resize handle */}
      {!fullScreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('fileBrowser.resizePanel')}
          aria-valuenow={width}
          aria-valuemin={FILE_BROWSER_MIN_WIDTH}
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
            onWidthChange(dragRef.current.startWidth + dx)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 50 : 10
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              onWidthChange(width + step)
            }
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              onWidthChange(width - step)
            }
          }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
        </div>
      )}

      <div className="flex flex-col h-full min-h-0">
        <FileBrowserContent
          headerActions={(
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
              aria-label={t('fileBrowser.close')}
              title={t('fileBrowser.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        />
      </div>
    </div>
  )
}
