import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog'
import { Button } from '@/components/ui/button'
import { useIssues, useProject } from '@/hooks/use-kanban'
import { tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition } from '@/lib/statuses'
import { STATUSES } from '@/lib/statuses'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { usePanelStore } from '@/stores/panel-store'
import type { Issue } from '@/types/kanban'

export function IssueListPanel({
  projectId,
  activeIssueId,
  projectName,
  width,
  onResizeStart,
  mobileNav,
}: {
  projectId: string
  activeIssueId: string
  projectName: string
  width?: number
  onResizeStart?: (e: React.MouseEvent) => void
  mobileNav?: React.ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issues } = useIssues(projectId)
  const { data: project } = useProject(projectId)
  const openCreateDialog = usePanelStore((s) => s.openCreateDialog)
  const toggleFileBrowser = useFileBrowserStore((s) => s.toggle)
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searchTerm = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!issues) return []
    if (!searchTerm) return issues
    return issues.filter((issue) =>
      issue.title.toLowerCase().includes(searchTerm),
    )
  }, [issues, searchTerm])

  // Build child map for parent-child grouping, sorted by statusUpdatedAt DESC
  const childMap = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const issue of filtered) {
      if (issue.parentIssueId) {
        const children = map.get(issue.parentIssueId) ?? []
        children.push(issue)
        map.set(issue.parentIssueId, children)
      }
    }
    for (const [key, children] of map.entries()) {
      map.set(
        key,
        children.sort(
          (a, b) =>
            new Date(b.statusUpdatedAt).getTime() -
            new Date(a.statusUpdatedAt).getTime(),
        ),
      )
    }
    return map
  }, [filtered])

  const grouped = useMemo(() => {
    if (!issues) return []
    const rootIssues = filtered.filter((i) => !i.parentIssueId)
    const map = new Map<string, Issue[]>()
    for (const issue of rootIssues) {
      const list = map.get(issue.statusId) ?? []
      list.push(issue)
      map.set(issue.statusId, list)
    }
    return STATUSES.map((status) => ({
      status,
      issues: (map.get(status.id) ?? []).sort(
        (a, b) =>
          new Date(b.statusUpdatedAt).getTime() -
          new Date(a.statusUpdatedAt).getTime(),
      ),
    }))
  }, [filtered, issues])

  const toggleCollapse = (statusId: string) => {
    setCollapsed((prev) => ({ ...prev, [statusId]: !prev[statusId] }))
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
          <span className="text-sm font-semibold truncate tracking-tight">
            {projectName}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          {project?.directory && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground md:hidden"
              onClick={() => toggleFileBrowser(projectId)}
              aria-label={t('viewMode.files')}
              title={t('viewMode.files')}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => openCreateDialog()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="group flex items-center gap-2 rounded-lg bg-card/80 border border-transparent px-2.5 py-1.5 transition-all duration-200 focus-within:border-primary/30 focus-within:bg-card focus-within:shadow-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-colors group-focus-within:text-primary/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {project ? (
        <ProjectSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          project={project}
        />
      ) : null}

      {/* Grouped issue list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.map(({ status, issues: groupIssues }) => (
          <StatusGroup
            key={status.id}
            status={status}
            issues={groupIssues}
            childMap={childMap}
            isCollapsed={!!collapsed[status.id]}
            onToggle={() => toggleCollapse(status.id)}
            activeIssueId={activeIssueId}
            onNavigate={(issueId) =>
              navigate(`/projects/${projectId}/issues/${issueId}`)
            }
          />
        ))}
      </div>

      {/* Resize handle */}
      {onResizeStart ? (
        <div
          role="separator"
          onMouseDown={onResizeStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-20"
        />
      ) : null}
    </div>
  )
}

function StatusGroup({
  status,
  issues,
  childMap,
  isCollapsed,
  onToggle,
  activeIssueId,
  onNavigate,
}: {
  status: StatusDefinition
  issues: Issue[]
  childMap: Map<string, Issue[]>
  isCollapsed: boolean
  onToggle: () => void
  activeIssueId: string
  onNavigate: (issueId: string) => void
}) {
  const { t } = useTranslation()
  const [expandedParents, setExpandedParents] = useState<
    Record<string, boolean>
  >({})

  const toggleParent = (id: string) => {
    setExpandedParents((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div>
      {/* Status header bar — tinted with the status color */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs sticky top-0 z-10 transition-colors border-b border-border/20"
        style={{ backgroundColor: `${status.color}14` }}
      >
        <span
          className="h-2 w-2 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-transparent"
          style={{
            backgroundColor: status.color,
            boxShadow: `0 0 6px ${status.color}40`,
          }}
        />
        <span className="font-semibold text-foreground/80 truncate tracking-tight">
          {tStatus(t, status.name)}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground/50 ml-auto shrink-0 tabular-nums">
          {issues.length}
        </span>
      </button>

      {!isCollapsed ? (
        <div>
          {issues.map((issue) => {
            const isActive = issue.id === activeIssueId
            const children = childMap.get(issue.id)
            const hasChildren = children && children.length > 0
            const isExpanded = expandedParents[issue.id]

            return (
              <div key={issue.id}>
                <IssueRow
                  issue={issue}
                  isActive={isActive}
                  hasChildren={!!hasChildren}
                  isExpanded={!!isExpanded}
                  onNavigate={onNavigate}
                  onToggleChildren={() => toggleParent(issue.id)}
                />

                {/* Indented children */}
                {isExpanded && children
                  ? children.map((child) => {
                      const isChildActive = child.id === activeIssueId
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => onNavigate(child.id)}
                          className={`w-full flex items-center gap-1 pl-5 pr-2 py-1.5 text-left border-b border-border/20 transition-all duration-150 ${
                            isChildActive
                              ? 'bg-primary/[0.06]'
                              : 'hover:bg-accent/50'
                          }`}
                        >
                          <span
                            className={`text-[10px] font-mono shrink-0 tabular-nums ${
                              isChildActive
                                ? 'text-primary font-medium'
                                : 'text-muted-foreground/60'
                            }`}
                          >
                            #{child.issueNumber}
                          </span>
                          <span
                            title={child.title}
                            className={`text-[12px] truncate ${
                              isChildActive
                                ? 'text-foreground font-medium'
                                : 'text-foreground/80'
                            }`}
                          >
                            {child.title}
                          </span>
                        </button>
                      )
                    })
                  : null}
              </div>
            )
          })}
          {issues.length === 0 ? (
            <div className="border-b border-border/20 px-2 py-3 min-h-[44px] flex items-center justify-center">
              <span className="text-[11px] text-muted-foreground/55 text-center pointer-events-none">
                {t('issue.emptyStatusHint')}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const IssueRow = memo(function IssueRow({
  issue,
  isActive,
  hasChildren,
  isExpanded,
  onNavigate,
  onToggleChildren,
}: {
  issue: Issue
  isActive: boolean
  hasChildren: boolean
  isExpanded: boolean
  onNavigate: (issueId: string) => void
  onToggleChildren: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(issue.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate(issue.id)
        }
      }}
      className={`w-full flex items-center gap-1 px-1.5 py-2.5 md:py-1.5 text-left border-b border-border/20 transition-all duration-150 cursor-pointer ${
        isActive ? 'bg-primary/[0.06]' : 'hover:bg-accent/50'
      }`}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleChildren()
          }}
          className="h-3.5 w-3.5 p-0 shrink-0 rounded hover:bg-accent transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span
        className={`text-[11px] font-mono shrink-0 tabular-nums ${
          isActive ? 'text-primary font-medium' : 'text-muted-foreground/70'
        }`}
      >
        #{issue.issueNumber}
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
