import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProject, useProjectFiles } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { FileBreadcrumb } from './FileBreadcrumb'
import { FileList } from './FileList'
import { FileViewer } from './FileViewer'

export function FileBrowserContent({
  headerActions,
  enabled = true,
}: {
  headerActions?: ReactNode
  enabled?: boolean
}) {
  const { t } = useTranslation()
  const {
    projectId,
    rootPath,
    currentPath,
    hideIgnored,
    navigateTo,
    toggleHideIgnored,
  } = useFileBrowserStore()

  const [copied, setCopied] = useState(false)

  const { data: project } = useProject(projectId ?? '')
  const effectiveRoot = rootPath ?? project?.directory ?? null

  const handleCopyPath = useCallback(() => {
    const fullPath = currentPath === '.' ? (effectiveRoot ?? '/') : (effectiveRoot ? `${effectiveRoot}/${currentPath}` : currentPath)
    navigator.clipboard.writeText(fullPath)
    setCopied(true)
    setTimeout(setCopied, 1500, false)
  }, [currentPath, effectiveRoot])

  const handleDownload = useCallback(() => {
    if (!effectiveRoot || currentPath === '.') return
    const url = kanbanApi.rawFileUrl(effectiveRoot, currentPath)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.click()
  }, [effectiveRoot, currentPath])

  const {
    data: listing,
    isLoading,
    isError,
    error,
  } = useProjectFiles(effectiveRoot, currentPath, !!effectiveRoot && enabled)

  const handleEntryClick = useCallback(
    (name: string, _type: 'file' | 'directory') => {
      const newPath = currentPath === '.' ? name : `${currentPath}/${name}`
      navigateTo(newPath)
    },
    [currentPath, navigateTo],
  )

  const handleFileBack = useCallback(() => {
    const parentPath = currentPath.includes('/')
      ? currentPath.slice(0, currentPath.lastIndexOf('/'))
      : '.'
    navigateTo(parentPath)
  }, [currentPath, navigateTo])

  return (
    <>
      {/* Header + Breadcrumb */}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-xs font-medium text-muted-foreground truncate font-mono" title={effectiveRoot ?? undefined}>
            {effectiveRoot ?? t('fileBrowser.title')}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopyPath}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('fileBrowser.copyPath')}
            title={t('fileBrowser.copyPath')}
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-green-500" />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
          {listing?.type === 'file' && (
            <button
              type="button"
              onClick={handleDownload}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={t('fileBrowser.download')}
              title={t('fileBrowser.download')}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleHideIgnored}
            className={`p-1 rounded transition-colors ${
              hideIgnored
                ? 'text-foreground bg-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            aria-label={t('fileBrowser.hideIgnored')}
            title={hideIgnored ? t('fileBrowser.showIgnored') : t('fileBrowser.hideIgnored')}
          >
            {hideIgnored ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          {headerActions}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0 p-4 flex flex-col">
        {!effectiveRoot
          ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <FolderOpen className="h-12 w-12" />
                <p className="text-sm">{t('fileBrowser.noDirectory')}</p>
              </div>
            )
          : isLoading
            ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )
            : isError
              ? (
                  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                    {(error as Error)?.message || t('fileBrowser.loadError')}
                  </div>
                )
              : listing?.type === 'file'
                ? (
                    <FileViewer
                      file={listing}
                      onBack={handleFileBack}
                      breadcrumb={<FileBreadcrumb path={currentPath} onNavigate={navigateTo} />}
                    />
                  )
                : listing?.type === 'directory'
                  ? (
                      <FileList
                        entries={listing.entries}
                        onNavigate={handleEntryClick}
                        breadcrumb={<FileBreadcrumb path={currentPath} onNavigate={navigateTo} />}
                      />
                    )
                  : null}
      </div>
    </>
  )
}
