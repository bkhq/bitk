import { ChevronRight, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FileBreadcrumbProps {
  projectName: string
  path: string
  onNavigate: (path: string) => void
}

export function FileBreadcrumb({
  projectName,
  path,
  onNavigate,
}: FileBreadcrumbProps) {
  const { t } = useTranslation()
  const segments = path && path !== '.' ? path.split('/') : []

  return (
    <nav
      aria-label={t('fileBrowser.breadcrumb')}
      className="flex items-center gap-1 text-sm overflow-x-auto"
    >
      <button
        type="button"
        onClick={() => onNavigate('.')}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="font-medium">{projectName}</span>
      </button>

      {segments.map((segment, i) => {
        const segmentPath = segments.slice(0, i + 1).join('/')
        const isLast = i === segments.length - 1

        return (
          <span key={segmentPath} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            {isLast ? (
              <span className="px-1.5 py-0.5 font-semibold text-foreground">
                {segment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPath)}
                className="px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
