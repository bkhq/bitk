import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { FileBreadcrumb } from '@/components/files/FileBreadcrumb'
import { FileList } from '@/components/files/FileList'
import { FileViewer } from '@/components/files/FileViewer'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { useProject, useProjectFiles } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'

export default function FileBrowserPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default', '*': splatPath = '' } = useParams<{
    projectId: string
    '*': string
  }>()
  const { data: project, isLoading, isError } = useProject(projectId)
  const isMobile = useIsMobile()

  const currentPath = splatPath || '.'

  // Single request: returns { type: 'directory', entries } or { type: 'file', content, ... }
  const {
    data: listing,
    isLoading: isListingLoading,
    isError: isListingError,
    error: listingError,
  } = useProjectFiles(projectId, currentPath)

  // Redirect if project not found
  useEffect(() => {
    if (!isLoading && (isError || !project)) {
      void navigate('/', { replace: true })
    }
  }, [isLoading, isError, project, navigate])

  const basePath = `/projects/${projectId}/files`

  const navigateToPath = useCallback(
    (path: string) => {
      if (!path || path === '.') {
        void navigate(basePath)
      } else {
        void navigate(`${basePath}/${path}`)
      }
    },
    [navigate, basePath],
  )

  const handleEntryClick = useCallback(
    (name: string, _type: 'file' | 'directory') => {
      const newPath = currentPath === '.' ? name : `${currentPath}/${name}`
      void navigate(`${basePath}/${newPath}`)
    },
    [currentPath, navigate, basePath],
  )

  const handleFileBack = useCallback(() => {
    const parentPath = currentPath.includes('/')
      ? currentPath.slice(0, currentPath.lastIndexOf('/'))
      : '.'
    navigateToPath(parentPath)
  }, [currentPath, navigateToPath])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">
          {t('kanban.loadingProject')}
        </p>
      </div>
    )
  }

  if (isError || !project) {
    return null
  }

  if (!project.directory) {
    return (
      <div className="flex h-full text-foreground animate-page-enter">
        {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <FolderOpen className="h-12 w-12" />
            <p className="text-sm">{t('fileBrowser.noDirectory')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full text-foreground animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}

      <div className="flex flex-1 min-w-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-background shrink-0">
          <FileBreadcrumb
            projectName={project.name}
            path={currentPath}
            onNavigate={navigateToPath}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isListingLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : isListingError ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              {(listingError as Error)?.message || t('fileBrowser.loadError')}
            </div>
          ) : listing?.type === 'file' ? (
            <FileViewer file={listing} onBack={handleFileBack} />
          ) : listing?.type === 'directory' ? (
            <FileList entries={listing.entries} onNavigate={handleEntryClick} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
