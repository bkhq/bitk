import DOMPurify from 'dompurify'
import { Code, Eye, FileWarning } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { codeToHtml } from '@/lib/shiki'
import type { FileContent } from '@/types/kanban'
import { MarkdownRenderer } from './MarkdownRenderer'

const CodeEditor = lazy(() => import('./CodeEditor').then(m => ({ default: m.CodeEditor })))

/** Infer language from file extension for Shiki syntax highlighting. */
function inferLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    vue: 'vue',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    graphql: 'graphql',
    dockerfile: 'dockerfile',
    xml: 'xml',
    svg: 'xml',
  }
  // Check filename-based detection
  const filename = path.split('/').pop()?.toLowerCase() ?? ''
  if (filename === 'dockerfile') return 'dockerfile'
  if (filename === 'makefile') return 'makefile'
  return map[ext] || 'text'
}

function isMarkdownFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'mdx'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileViewerProps {
  file: FileContent
  breadcrumb?: React.ReactNode
  isEditing?: boolean
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSave?: (content: string) => void
  isSaving?: boolean
}

export function FileViewer({
  file,
  breadcrumb,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  isSaving,
}: FileViewerProps) {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const isMd = isMarkdownFile(file.path)
  const [showRendered, setShowRendered] = useState(isMd)
  const prevPath = useRef(file.path)
  const [editContent, setEditContent] = useState(file.content)

  // Reset view mode when navigating to a different file
  if (prevPath.current !== file.path) {
    prevPath.current = file.path
    setShowRendered(isMarkdownFile(file.path))
  }

  // Sync edit content when entering edit mode or file changes
  useEffect(() => {
    if (isEditing) {
      setEditContent(file.content)
    }
  }, [isEditing, file.content])

  const handleEditorSave = useCallback(() => {
    onSave?.(editContent)
  }, [onSave, editContent])

  const lineCount = file.content ? file.content.split('\n').length : 0
  const fileName = file.path.split('/').pop() ?? file.path

  useEffect(() => {
    if (file.isBinary) {
      setLoading(false)
      return
    }

    // Skip Shiki highlighting when showing rendered markdown or editing
    if ((isMd && showRendered) || isEditing) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const lang = inferLang(file.path)
    void codeToHtml(file.content, lang).then((result) => {
      if (!cancelled) {
        setHtml(result)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [file.content, file.path, file.isBinary, isMd, showRendered, isEditing])

  if (file.isBinary) {
    return (
      <div className="overflow-hidden">
        {breadcrumb && (
          <div className="bg-muted/50 border-b border-border px-4 py-1.5">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
          <span className="font-medium text-sm truncate">{fileName}</span>
          <span className="text-xs text-muted-foreground shrink-0">{formatSize(file.size)}</span>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <FileWarning className="h-10 w-10" />
          <p className="text-sm">{t('fileBrowser.binaryFile')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {breadcrumb && (
        <div className="bg-muted/50 border-b border-border px-4 py-1.5 shrink-0">
          {breadcrumb}
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border shrink-0">
        <span className="font-medium text-sm truncate">{fileName}</span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {isEditing
            ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {t('fileBrowser.editing')}
                  </span>
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="rounded px-2 py-0.5 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {t('fileBrowser.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => onSave?.(editContent)}
                    className="rounded px-2 py-0.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {isSaving ? t('fileBrowser.saving') : t('fileBrowser.save')}
                  </button>
                </div>
              )
            : (
                <>
                  {isMd
                    ? (
                        <button
                          type="button"
                          onClick={() => setShowRendered(v => !v)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                          title={showRendered ? t('fileBrowser.viewSource') : t('fileBrowser.viewRendered')}
                        >
                          {showRendered ? <Code className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          <span>
                            {showRendered ? t('fileBrowser.viewSource') : t('fileBrowser.viewRendered')}
                          </span>
                        </button>
                      )
                    : null}
                  {onStartEdit && !file.isTruncated && (
                    <button
                      type="button"
                      onClick={onStartEdit}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      title={t('fileBrowser.edit')}
                    >
                      <Code className="h-3.5 w-3.5" />
                      <span>{t('fileBrowser.edit')}</span>
                    </button>
                  )}
                  <span>
                    {lineCount}
                    {' '}
                    {t('fileBrowser.lines')}
                  </span>
                  <span>{formatSize(file.size)}</span>
                  {file.isTruncated
                    ? (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {t('fileBrowser.truncated')}
                        </span>
                      )
                    : null}
                </>
              )}
        </div>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {isEditing
          ? (
              <Suspense fallback={(
                <div className="flex items-center justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
              >
                <CodeEditor
                  value={editContent}
                  filePath={file.path}
                  onChange={setEditContent}
                  onSave={handleEditorSave}
                  onCancel={onCancelEdit}
                />
              </Suspense>
            )
          : loading
            ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )
            : isMd && showRendered
              ? (
                  <MarkdownRenderer content={file.content} />
                )
              : (
                  <div
                    className="shiki-line-numbers text-xs [&_pre]:!bg-transparent [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:overflow-x-auto [&_code]:leading-snug"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
                  />
                )}
      </div>
    </div>
  )
}
