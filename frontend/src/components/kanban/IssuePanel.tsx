import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Maximize2, Link, Check, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ChatBody } from '@/components/issue-detail/ChatBody'
import { DiffPanel } from '@/components/issue-detail/DiffPanel'
import { SubIssueDialog } from '@/components/issue-detail/SubIssueDialog'
import { useIssue, useUpdateIssue } from '@/hooks/use-kanban'

const DEFAULT_DIFF_WIDTH = 360

interface IssuePanelProps {
  projectId: string
  issueId?: string | null
  onClose: () => void
  hideHeaderActions?: boolean
}

export function IssuePanel({
  projectId,
  issueId,
  onClose,
  hideHeaderActions,
}: IssuePanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showSubIssue, setShowSubIssue] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diffWidth, setDiffWidth] = useState(DEFAULT_DIFF_WIDTH)

  const { data: issue } = useIssue(projectId, issueId ?? '')
  const effectiveIssue = issue

  const updateIssue = useUpdateIssue(projectId)

  const displayId = effectiveIssue ? `#${effectiveIssue.issueNumber}` : ''

  // --- Title editing ---
  const saveTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (trimmed && effectiveIssue && trimmed !== effectiveIssue.title) {
      updateIssue.mutate({ id: effectiveIssue.id, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, effectiveIssue, updateIssue])

  const startEditingTitle = useCallback(() => {
    if (effectiveIssue) {
      setTitleDraft(effectiveIssue.title)
      setEditingTitle(true)
    }
  }, [effectiveIssue])

  // Auto-focus panel on mount
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const target = e.target as HTMLElement
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (isEditable) {
        target.blur()
        e.stopPropagation()
      } else {
        onClose()
      }
    }
  }

  const handleCopyLink = () => {
    if (!issueId) return
    const url = `${window.location.origin}/projects/${projectId}/issues/${issueId}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div
      ref={panelRef}
      className="relative flex flex-col h-full overflow-hidden bg-card outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
              {displayId}
            </span>
            {editingTitle ? (
              <input
                className="text-sm font-semibold bg-transparent border-b-2 border-primary outline-none min-w-0 flex-1 tracking-tight"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveTitle()
                  } else if (e.key === 'Escape') {
                    setEditingTitle(false)
                  }
                }}
                autoFocus
              />
            ) : (
              <span
                className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors duration-200 tracking-tight decoration-primary/30 hover:underline underline-offset-2"
                onClick={startEditingTitle}
                title={t('issue.editTitle')}
              >
                {effectiveIssue?.title}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!effectiveIssue?.parentIssueId && issueId ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              title={t('issue.createSubIssue')}
              onClick={() => setShowSubIssue(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {!hideHeaderActions ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 transition-all duration-200 ${copied ? 'text-emerald-500 scale-110' : 'text-muted-foreground hover:text-foreground'}`}
                title={t('issue.copyLink')}
                onClick={handleCopyLink}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Link className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                title={t('issue.openFullPage')}
                onClick={() => {
                  navigate(`/projects/${projectId}/issues/${issueId}`)
                  onClose()
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
            title={t('issue.closePanel')}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Shared chat body: messages + metadata bar + input */}
      {effectiveIssue && issueId ? (
        <ChatBody
          projectId={projectId}
          issueId={issueId}
          issue={effectiveIssue}
          showDiff={showDiff}
          onToggleDiff={() => setShowDiff((v) => !v)}
          scrollRef={scrollRef}
        />
      ) : null}

      {/* Diff panel — full-screen overlay within the panel */}
      {showDiff && issueId ? (
        <div className="absolute inset-0 z-40 bg-background flex flex-col">
          <DiffPanel
            projectId={projectId}
            issueId={issueId}
            width={diffWidth}
            onWidthChange={setDiffWidth}
            onClose={() => setShowDiff(false)}
            fullScreen
          />
        </div>
      ) : null}

      {/* Sub-issue dialog */}
      {issueId ? (
        <SubIssueDialog
          projectId={projectId}
          parentIssueId={issueId}
          open={showSubIssue}
          onOpenChange={setShowSubIssue}
        />
      ) : null}
    </div>
  )
}
