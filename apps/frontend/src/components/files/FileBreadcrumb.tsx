import { Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FileBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
}

export function FileBreadcrumb({ path, onNavigate }: FileBreadcrumbProps) {
  const { t } = useTranslation()
  const segments = path && path !== '.' ? path.split('/') : []

  return (
    <nav
      aria-label={t('fileBrowser.breadcrumb')}
      className="flex items-center gap-1.5 text-sm overflow-x-auto h-5"
    >
      <button
        type="button"
        onClick={() => onNavigate('.')}
        className="text-primary hover:text-primary/80 shrink-0 flex items-center gap-1"
      >
        <Home className="h-3.5 w-3.5" />
      </button>

      {segments.map((segment, i) => {
        const segmentPath = segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1

        return (
          <span key={segmentPath} className="flex items-center gap-1.5 shrink-0 text-xs">
            <span className="text-muted-foreground/40">/</span>
            {isLast
              ? (
                  <span className="font-semibold text-foreground">{segment}</span>
                )
              : (
                  <button
                    type="button"
                    onClick={() => onNavigate(segmentPath)}
                    className="text-primary hover:underline underline-offset-2"
                  >
                    {segment}
                  </button>
                )}
          </span>
        )
      })}
    </nav>
  )
}
