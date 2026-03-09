import { ChevronDown, GitBranch, Tag, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useProjectWorktrees } from '@/hooks/use-kanban'
import { tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition, StatusId } from '@/lib/statuses'
import { STATUSES } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'

export const badgeBase =
  'inline-flex items-center gap-1 rounded-full border px-2 h-[22px] text-[11px] leading-none font-medium whitespace-nowrap'

const badgeButtonBase = 'h-[22px] rounded-full px-2 text-[11px] leading-none font-medium gap-1'

export function IssueDetail({
  issue,
  projectId,
  status,
  onUpdate,
  onDelete,
  isDeleting = false,
}: {
  issue: Issue
  projectId?: string
  status?: StatusDefinition
  onUpdate?: (fields: Partial<Pick<Issue, 'statusId' | 'tags'>>) => void
  onDelete?: () => void
  isDeleting?: boolean
}) {
  const { t } = useTranslation()
  const [editingTag, setEditingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)
  const [showWorktree, setShowWorktree] = useState(false)
  const worktreeRef = useRef<HTMLDivElement>(null)
  useClickOutside(worktreeRef, showWorktree, () => setShowWorktree(false))

  const { data: worktrees } = useProjectWorktrees(issue.useWorktree && projectId ? projectId : '')
  const worktreeEntry = useMemo(
    () => worktrees?.find(w => w.issueId === issue.id),
    [worktrees, issue.id],
  )
  const worktreePath = worktreeEntry?.path ?? ''
  const worktreeBranch = worktreeEntry?.branch ?? (issue.id ? `bkd/${issue.id}` : '')

  return (
    <div className="shrink-0 relative z-20 flex items-center gap-1.5 px-4 py-1.5 border-t border-border/40 bg-muted/20">
      {/* Status — editable */}
      <StatusSelect status={status} onChange={id => onUpdate?.({ statusId: id })} />

      {/* Tags — editable (comma-separated) */}
      {editingTag ?
          (
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onBlur={() => {
                const newTags = tagInput
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
                const prev = issue.tags ?? []
                if (JSON.stringify(newTags) !== JSON.stringify(prev)) {
                  onUpdate?.({ tags: newTags.length > 0 ? newTags : null })
                }
                setEditingTag(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setTagInput((issue.tags ?? []).join(', '))
                  setEditingTag(false)
                }
              }}
              placeholder={t('issue.tagPlaceholder')}
              className={`${badgeBase} border-primary/40 bg-background outline-none w-40`}
            />
          ) :
          (
            <button
              type="button"
              onClick={() => {
                setTagInput((issue.tags ?? []).join(', '))
                setEditingTag(true)
                requestAnimationFrame(() => tagInputRef.current?.focus())
              }}
              className={`${badgeBase} cursor-pointer transition-colors ${
                issue.tags && issue.tags.length > 0 ?
                  'border-border/50 bg-muted/30 text-muted-foreground hover:border-border' :
                  'border-dashed border-border/40 text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-border/60'
              }`}
              title={t('issue.tag')}
            >
              <Tag className="h-3 w-3" />
              {issue.tags && issue.tags.length > 0 ? issue.tags.join(', ') : t('issue.tag')}
            </button>
          )}

      {/* Delete */}
      {onDelete ?
          (
            <Button
              type="button"
              onClick={onDelete}
              size="sm"
              variant="outline"
              disabled={isDeleting}
              className={`${badgeButtonBase} cursor-pointer border-border/50 bg-muted/20 text-muted-foreground/60 hover:text-destructive hover:border-destructive/30 hover:bg-destructive/10`}
              title={t('issue.delete')}
            >
              <Trash2 className="h-3 w-3" />
              <span>{isDeleting ? t('issue.deleting') : t('issue.delete')}</span>
            </Button>
          ) :
        null}

      {/* Worktree (right side) */}
      <div className="ml-auto flex items-center gap-1.5">
        {issue.useWorktree ?
            (
              <div ref={worktreeRef} className="relative flex">
                <button
                  type="button"
                  onClick={() => setShowWorktree(v => !v)}
                  className={`${badgeBase} cursor-pointer transition-colors border-emerald-400/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:opacity-80`}
                >
                  <GitBranch className="h-3 w-3" />
                  {t('chat.worktree')}
                </button>
                {showWorktree ?
                    (
                      <div className="absolute right-0 bottom-full mb-1.5 z-50 min-w-[240px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-2 px-3 shadow-xl text-xs text-popover-foreground space-y-1.5">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <GitBranch className="h-3 w-3 shrink-0" />
                          <span className="font-medium text-foreground">{t('chat.worktree')}</span>
                        </div>
                        <div className="space-y-1 text-muted-foreground">
                          <div className="flex items-start gap-2">
                            <span className="shrink-0">
                              {t('chat.worktreeBranch')}
                              :
                            </span>
                            <code className="font-mono text-foreground/80 break-all">{worktreeBranch}</code>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="shrink-0">
                              {t('chat.worktreePath')}
                              :
                            </span>
                            <code className="font-mono text-foreground/80 break-all">{worktreePath}</code>
                          </div>
                        </div>
                      </div>
                    ) :
                  null}
              </div>
            ) :
          null}
      </div>
    </div>
  )
}

export function StatusSelect({
  status,
  onChange,
}: {
  status?: StatusDefinition
  onChange: (id: StatusId) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  if (!status) return null

  return (
    <div ref={ref} className="relative flex">
      <Button
        type="button"
        onClick={() => setOpen(v => !v)}
        size="sm"
        variant="outline"
        className={`${badgeButtonBase} cursor-pointer transition-colors hover:opacity-80`}
        style={{
          borderColor: `${status.color}30`,
          backgroundColor: `${status.color}08`,
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        {tStatus(t, status.name)}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>
      {open ?
          (
            <div className="absolute left-0 bottom-full mb-1.5 z-50 min-w-[120px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-1 shadow-xl text-xs text-popover-foreground">
              {STATUSES.map((s) => {
                const isActive = s.id === status.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (s.id !== status.id) onChange(s.id)
                      setOpen(false)
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                      isActive ? 'bg-primary/10 font-medium' : 'hover:bg-accent/50'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    {tStatus(t, s.name)}
                  </button>
                )
              })}
            </div>
          ) :
        null}
    </div>
  )
}
