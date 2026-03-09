import { Search } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useReviewIssues } from '@/hooks/use-kanban'
import type { Issue } from '@/types/kanban'

type ReviewIssue = Issue & { projectName: string, projectAlias: string }

export function ReviewListPanel({
  activeIssueId,
  width,
  onResizeStart,
  mobileNav,
}: {
  activeIssueId: string
  width?: number
  onResizeStart?: (e: React.MouseEvent) => void
  mobileNav?: React.ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issues, isLoading } = useReviewIssues()
  const [search, setSearch] = useState('')
  const searchTerm = search.trim().toLowerCase()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const filtered = useMemo(() => {
    if (!issues) return []
    if (!searchTerm) return issues
    return issues.filter(
      issue =>
        issue.title.toLowerCase().includes(searchTerm) ||
        issue.projectName.toLowerCase().includes(searchTerm),
    )
  }, [issues, searchTerm])

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        projectId: string
        projectName: string
        projectAlias: string
        issues: ReviewIssue[]
      }
    >()
    for (const issue of filtered) {
      const existing = map.get(issue.projectId)
      if (existing) {
        existing.issues.push(issue)
      } else {
        map.set(issue.projectId, {
          projectId: issue.projectId,
          projectName: issue.projectName,
          projectAlias: issue.projectAlias,
          issues: [issue],
        })
      }
    }
    return [...map.values()]
  }, [filtered])

  const toggleCollapse = (projectId: string) => {
    setCollapsed(prev => ({ ...prev, [projectId]: !prev[projectId] }))
  }

  return (
    <div
      className="relative flex flex-col h-full w-full border-r border-border bg-secondary shrink-0"
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border/60 shrink-0 min-h-[42px] bg-secondary/50">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobileNav}
          <span className="text-sm font-semibold truncate tracking-tight">{t('review.title')}</span>
        </div>
        {issues ?
            (
              <span className="text-[10px] font-medium text-muted-foreground/50 shrink-0 tabular-nums">
                {issues.length}
              </span>
            ) :
          null}
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="group flex items-center gap-2 rounded-lg bg-card/80 border border-transparent px-2.5 py-1.5 transition-all duration-200 focus-within:border-primary/30 focus-within:bg-card focus-within:shadow-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-colors group-focus-within:text-primary/60" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* Grouped issue list by project */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ?
            (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) :
          grouped.length === 0 ?
              (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground/55">{t('review.empty')}</p>
                </div>
              ) :
              (
                grouped.map(group => (
                  <ProjectGroup
                    key={group.projectId}
                    projectName={group.projectName}
                    projectAlias={group.projectAlias}
                    issues={group.issues}
                    isCollapsed={!!collapsed[group.projectId]}
                    onToggle={() => toggleCollapse(group.projectId)}
                    activeIssueId={activeIssueId}
                    onNavigate={(projectAlias, issueId) => navigate(`/review/${projectAlias}/${issueId}`)}
                  />
                ))
              )}
      </div>

      {/* Resize handle */}
      {onResizeStart ?
          (
            <div
              role="separator"
              onMouseDown={onResizeStart}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-20"
            />
          ) :
        null}
    </div>
  )
}

function ProjectGroup({
  projectName,
  projectAlias,
  issues,
  isCollapsed,
  onToggle,
  activeIssueId,
  onNavigate,
}: {
  projectName: string
  projectAlias: string
  issues: ReviewIssue[]
  isCollapsed: boolean
  onToggle: () => void
  activeIssueId: string
  onNavigate: (projectAlias: string, issueId: string) => void
}) {
  const reviewColor = '#f59e0b' // amber — matches review status color

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs sticky top-0 z-10 transition-colors border-b border-border/20"
        style={{ backgroundColor: `${reviewColor}14` }}
      >
        <span
          className="h-2 w-2 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-transparent"
          style={{
            backgroundColor: reviewColor,
            boxShadow: `0 0 6px ${reviewColor}40`,
          }}
        />
        <span className="font-semibold text-foreground/80 truncate tracking-tight">
          {projectName}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground/50 ml-auto shrink-0 tabular-nums">
          {issues.length}
        </span>
      </button>

      {!isCollapsed ?
          (
            <div>
              {issues.map(issue => (
                <ReviewIssueRow
                  key={issue.id}
                  issue={issue}
                  isActive={issue.id === activeIssueId}
                  onNavigate={() => onNavigate(projectAlias, issue.id)}
                />
              ))}
            </div>
          ) :
        null}
    </div>
  )
}

const ReviewIssueRow = memo(({
  issue,
  isActive,
  onNavigate,
}: {
  issue: ReviewIssue
  isActive: boolean
  onNavigate: () => void
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate()
        }
      }}
      className={`w-full flex items-center gap-1 px-1.5 py-2.5 md:py-1.5 text-left border-b border-border/20 transition-all duration-150 cursor-pointer ${
        isActive ? 'bg-primary/[0.06]' : 'hover:bg-accent/50'
      }`}
    >
      <span className="w-3.5 shrink-0" />
      <span
        className={`text-[11px] font-mono shrink-0 tabular-nums ${
          isActive ? 'text-primary font-medium' : 'text-muted-foreground/70'
        }`}
      >
        #
        {issue.issueNumber}
      </span>
      <span
        title={issue.title}
        className={`text-[13px] truncate ${
          isActive ? 'text-foreground font-medium' : 'text-foreground/90'
        }`}
      >
        {issue.title}
      </span>
    </div>
  )
})
