import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MultiFileDiff, PatchDiff } from '@pierre/diffs/react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/use-theme'
import { useIssueChanges, useIssueFilePatch } from '@/hooks/use-kanban'

const MIN_WIDTH = 260

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

  return (
    <div
      className={
        fullScreen
          ? 'flex flex-col flex-1 min-h-0 bg-background'
          : 'relative h-full shrink-0 border-l border-border bg-background'
      }
      style={fullScreen ? undefined : { width }}
    >
      {!fullScreen ? (
        <ResizeHandle width={width} onWidthChange={onWidthChange} />
      ) : null}

      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {t('diff.changes')}
            </span>
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
            <span className="text-sm text-muted-foreground text-center">
              {t('common.loading')}
            </span>
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
            <span className="text-sm text-muted-foreground text-center">
              {t('diff.noChanges')}
            </span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y p-2 space-y-2">
            {files.map((file) => (
              <DiffFileCard
                key={file.path}
                projectId={projectId}
                issueId={issueId}
                path={file.path}
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

export { MIN_WIDTH as DIFF_MIN_WIDTH }

function DiffFileCard({
  projectId,
  issueId,
  path,
  additions,
  deletions,
}: {
  projectId: string
  issueId: string
  path: string
  additions?: number
  deletions?: number
}) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
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

  return (
    <details
      className="group rounded-xl border border-border/30 bg-card/50 transition-all duration-150 open:bg-card/70 open:border-border/40"
      open={isOpen}
      onToggle={(e) => setIsOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="list-none cursor-pointer rounded-xl bg-muted/15 px-2.5 py-2 transition-all duration-150 hover:bg-muted/30 group-open:rounded-b-none group-open:border-b group-open:border-border/30">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] truncate">{path}</span>
          {displayAdditions > 0 || displayDeletions > 0 ? (
            <span className="shrink-0 text-[11px] font-medium">
              {displayAdditions > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{displayAdditions}
                </span>
              ) : null}
              {displayAdditions > 0 && displayDeletions > 0 ? (
                <span className="px-0.5" />
              ) : null}
              {displayDeletions > 0 ? (
                <span className="text-red-600 dark:text-red-400">
                  -{displayDeletions}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </summary>
      {isOpen ? (
        <div className="min-w-0">
          {patchQuery.isLoading ? (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : patchQuery.isError ? (
            <div className="px-2.5 py-2 text-[11px] text-destructive">
              {String(patchQuery.error.message || t('diff.loadFailed'))}
            </div>
          ) : fullFilePair ? (
            <div className="overflow-x-auto">
              <MultiFileDiff
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
            </div>
          ) : patchText.trim() ? (
            <PatchDiffView patch={patchText} />
          ) : (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
              {t('diff.emptyPatch')}
            </div>
          )}
          {patch?.truncated ? (
            <div className="px-2.5 pb-2 text-[11px] text-muted-foreground">
              {t('diff.truncated')}
            </div>
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
      <PatchDiff
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
        onWidthChange(Math.max(MIN_WIDTH, next))
      }}
      onPointerUp={() => {
        dragRef.current = null
      }}
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/40 group-active:bg-primary/70 transition-all duration-200 group-hover:w-1.5" />
    </div>
  )
}
