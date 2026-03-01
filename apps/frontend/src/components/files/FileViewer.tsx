import { ArrowLeft, Code, Eye, FileWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { codeToHtml } from '@/lib/shiki'
import type { FileContent } from '@/types/kanban'
import { MarkdownRenderer } from './MarkdownRenderer'

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
  onBack: () => void
}

export function FileViewer({ file, onBack }: FileViewerProps) {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const isMd = isMarkdownFile(file.path)
  const [showRendered, setShowRendered] = useState(isMd)

  const lineCount = file.content ? file.content.split('\n').length : 0
  const fileName = file.path.split('/').pop() ?? file.path

  useEffect(() => {
    if (file.isBinary) {
      setLoading(false)
      return
    }

    // Skip Shiki highlighting when showing rendered markdown
    if (isMd && showRendered) {
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
  }, [file.content, file.path, file.isBinary, isMd, showRendered])

  if (file.isBinary) {
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              aria-label={t('fileBrowser.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-medium text-sm">{fileName}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatSize(file.size)}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <FileWarning className="h-10 w-10" />
          <p className="text-sm">{t('fileBrowser.binaryFile')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            aria-label={t('fileBrowser.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="font-medium text-sm">{fileName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {isMd ? (
            <button
              type="button"
              onClick={() => setShowRendered((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              title={
                showRendered
                  ? t('fileBrowser.viewSource')
                  : t('fileBrowser.viewRendered')
              }
            >
              {showRendered ? (
                <Code className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              <span>
                {showRendered
                  ? t('fileBrowser.viewSource')
                  : t('fileBrowser.viewRendered')}
              </span>
            </button>
          ) : null}
          <span>
            {lineCount} {t('fileBrowser.lines')}
          </span>
          <span>{formatSize(file.size)}</span>
          {file.isTruncated ? (
            <span className="text-yellow-600 dark:text-yellow-400">
              {t('fileBrowser.truncated')}
            </span>
          ) : null}
        </div>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-16rem)]">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isMd && showRendered ? (
          <MarkdownRenderer content={file.content} />
        ) : (
          <div
            className="shiki-line-numbers text-sm [&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:leading-relaxed"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki generates safe HTML
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
