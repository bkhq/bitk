import { ChevronRight, Copy, FolderOpen, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIssueChanges, useIssueFilePatch } from '@/hooks/use-kanban'
import { useTheme } from '@/hooks/use-theme'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { IssueChangedFile } from '@/types/kanban'
import { DIFF_MIN_WIDTH } from './diff-constants'

const LazyMultiFileDiff = lazy(() =>
  import('@pierre/diffs/react').then((m) => ({ default: m.MultiFileDiff })),
)

const LazyPatchDiff = lazy(() =>
  import('@pierre/diffs/react').then((m) => ({ default: m.PatchDiff })),
)

function getPatchStats(patch: string): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

type FileType = IssueChangedFile['type']

function FileTypeBadge({ type }: { type: FileType }) {
  const { t } = useTranslation()
  if (type === 'added' || type === 'untracked') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.new')}
      </span>
    )
  }
  if (type === 'deleted') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-red-600 dark:text-red-400 border border-red-500/30 bg-red-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.deleted')}
      </span>
    )
  }
  if (type === 'renamed') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-blue-600 dark:text-blue-400 border border-blue-500/30 bg-blue-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.renamed')}
      </span>
    )
  }
  return null
}

export function DiffPanel({
  projectId,
  issueId,
  width,
  onWidthChange,
  onClose,
  fullScreen,
}: {
  projectId: string
  issueId: string
  width: number
  onWidthChange: (w: number) => void
  onClose: () => void
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const changesQuery = useIssueChanges(projectId, issueId, true)
  const files = changesQuery.data?.files ?? []
  const changesRoot = changesQuery.data?.root
  const openFileBrowser = useFileBrowserStore((s) => s.open)

  return (
    <div
      className={
        fullScreen
          ? 'flex flex-col flex-1 min-h-0 bg-background'
          : 'relative h-full shrink-0 border-l border-border bg-background'
      }
      style={fullScreen ? undefined : { width }}
    >
      {!fullScreen ? <ResizeHandle width={width} onWidthChange={onWidthChange} /> : null}

      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openFileBrowser(projectId, changesRoot)}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
              title={t('diff.openFiles')}
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tracking-tight">{t('diff.changes')}</span>
            <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/50 rounded-full px-1.5 py-0.5 tabular-nums">
              {files.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
            aria-label={t('diff.closeDiffPanel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {changesQuery.isLoading ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <span className="text-sm text-muted-foreground text-center">{t('common.loading')}</span>
          </div>
        ) : changesQuery.isError ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <span className="text-sm text-muted-foreground text-center">
              {String(changesQuery.error.message || t('diff.loadFailed'))}
            </span>
          </div>
        ) : !changesQuery.data?.gitRepo ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <span className="text-sm text-muted-foreground text-center">
              {t('diff.notGitRepo')}
            </span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <span className="text-sm text-muted-foreground text-center">{t('diff.noChanges')}</span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y p-2 space-y-2">
            {files.map((file) => (
              <DiffFileCard
                key={file.path}
                projectId={projectId}
                issueId={issueId}
                path={file.path}
                type={file.type}
                additions={file.additions}
                deletions={file.deletions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { DIFF_MIN_WIDTH }

function DiffFileCard({
  projectId,
  issueId,
  path,
  type,
  additions,
  deletions,
}: {
  projectId: string
  issueId: string
  path: string
  type: FileType
  additions?: number
  deletions?: number
}) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const patchQuery = useIssueFilePatch(projectId, issueId, path, isOpen)
  const patch = patchQuery.data
  const patchText = patch?.patch ?? ''
  const stats = useMemo(() => getPatchStats(patchText), [patchText])
  const displayAdditions = additions ?? stats.additions
  const displayDeletions = deletions ?? stats.deletions
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const fullFilePair =
    patch && patch.oldText !== undefined && patch.newText !== undefined
      ? { oldText: patch.oldText, newText: patch.newText }
      : null

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCopyPath = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      void navigator.clipboard
        .writeText(path)
        .then(() => {
          setCopied(true)
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
          copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
        })
        .catch(() => {})
    },
    [path],
  )

  return (
    <details
      className="group/card rounded-xl border border-border/40 bg-card/60 overflow-hidden transition-all duration-150 open:bg-card open:border-border/50 open:shadow-sm"
      open={isOpen}
      onToggle={(e) => setIsOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="list-none cursor-pointer select-none px-3 py-2.5 transition-colors duration-150 hover:bg-muted/25">
        <div className="flex items-center gap-2">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-open/card:rotate-90" />
          <span className="min-w-0 truncate text-[12.5px] font-medium">{path}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <FileTypeBadge type={type} />
            <button
              type="button"
              onClick={handleCopyPath}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-muted/40"
              aria-label={t('diff.copyPath')}
              title={t('diff.copyPath')}
            >
              <Copy className={`h-3 w-3 ${copied ? 'text-emerald-500' : ''}`} />
            </button>
            <span className="flex items-center gap-0.5 text-[11px] font-medium tabular-nums">
              {displayAdditions > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">+{displayAdditions}</span>
              ) : null}
              {displayDeletions > 0 ? (
                <span className="text-red-600 dark:text-red-400">-{displayDeletions}</span>
              ) : null}
            </span>
          </div>
        </div>
      </summary>
      {isOpen ? (
        <div className="min-w-0 border-t border-border/30">
          {patchQuery.isLoading ? (
            <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : patchQuery.isError ? (
            <div className="px-3 py-2.5 text-[11px] text-destructive">
              {String(patchQuery.error.message || t('diff.loadFailed'))}
            </div>
          ) : fullFilePair ? (
            <div className="overflow-x-auto">
              <Suspense
                fallback={
                  <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                    {t('common.loading')}
                  </div>
                }
              >
                <LazyMultiFileDiff
                  oldFile={{ name: path, contents: fullFilePair.oldText }}
                  newFile={{ name: path, contents: fullFilePair.newText }}
                  options={{
                    diffStyle: 'unified',
                    diffIndicators: 'bars',
                    expandUnchanged: false,
                    hunkSeparators: 'line-info',
                    disableLineNumbers: false,
                    overflow: 'wrap',
                    theme: {
                      light: 'github-light-default',
                      dark: 'github-dark-default',
                    },
                    themeType,
                    disableFileHeader: true,
                  }}
                />
              </Suspense>
            </div>
          ) : patchText.trim() ? (
            <PatchDiffView patch={patchText} />
          ) : (
            <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
              {t('diff.emptyPatch')}
            </div>
          )}
          {patch?.truncated ? (
            <div className="px-3 pb-2 text-[11px] text-muted-foreground">{t('diff.truncated')}</div>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}

function PatchDiffView({ patch }: { patch: string }) {
  const { resolved } = useTheme()
  const isLikelyPatch = useMemo(
    () => patch.includes('@@') || patch.includes('\ndiff --git '),
    [patch],
  )
  const themeType = resolved === 'dark' ? 'dark' : 'light'

  if (!isLikelyPatch) {
    return (
      <pre className="px-2.5 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
        {patch}
      </pre>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Suspense
        fallback={
          <pre className="px-2.5 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {patch}
          </pre>
        }
      >
        <LazyPatchDiff
          patch={patch}
          options={{
            diffStyle: 'unified',
            diffIndicators: 'bars',
            expandUnchanged: true,
            disableLineNumbers: false,
            overflow: 'wrap',
            theme: {
              light: 'github-light-default',
              dark: 'github-dark-default',
            },
            themeType,
            disableFileHeader: true,
          }}
        />
      </Suspense>
    </div>
  )
}

function ResizeHandle({
  width,
  onWidthChange,
}: {
  width: number
  onWidthChange: (w: number) => void
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 z-10 cursor-col-resize group select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startX: e.clientX, startWidth: width }
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        const dx = dragRef.current.startX - e.clientX
        const next = dragRef.current.startWidth + dx
        onWidthChange(Math.max(DIFF_MIN_WIDTH, next))
      }}
      onPointerUp={() => {
        dragRef.current = null
      }}
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/40 group-active:bg-primary/70 transition-all duration-200 group-hover:w-1.5" />
    </div>
  )
}
