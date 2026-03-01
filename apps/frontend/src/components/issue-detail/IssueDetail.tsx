import { Bug, Calendar, ChevronDown, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PriorityIcon } from '@/components/kanban/PriorityIcon'
import { Button } from '@/components/ui/button'
import { useClickOutside } from '@/hooks/use-click-outside'
import { tPriority, tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition, StatusId } from '@/lib/statuses'
import { STATUSES } from '@/lib/statuses'
import type { Issue, Priority } from '@/types/kanban'

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low']

export const badgeBase =
  'inline-flex items-center gap-1 rounded-full border px-2 h-[22px] text-[11px] leading-none font-medium whitespace-nowrap'

const badgeButtonBase =
  'h-[22px] rounded-full px-2 text-[11px] leading-none font-medium gap-1'

function formatDate(iso: string, lang: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function IssueDetail({
  issue,
  status,
  onUpdate,
  onDelete,
  isDeleting = false,
}: {
  issue: Issue
  status?: StatusDefinition
  onUpdate?: (
    fields: Partial<Pick<Issue, 'statusId' | 'priority' | 'devMode'>>,
  ) => void
  onDelete?: () => void
  isDeleting?: boolean
}) {
  const { t, i18n } = useTranslation()

  return (
    <div className="shrink-0 relative z-20 flex items-center gap-1.5 px-4 py-1.5 border-t border-border/40 bg-muted/20">
      {/* Status — editable */}
      <StatusSelect
        status={status}
        onChange={(id) => onUpdate?.({ statusId: id })}
      />

      {/* Priority — editable */}
      <PrioritySelect
        value={issue.priority}
        onChange={(p) => onUpdate?.({ priority: p })}
      />

      {/* Delete */}
      {onDelete ? (
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
      ) : null}

      {/* Dev mode toggle + Created (right side) */}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          onClick={() => onUpdate?.({ devMode: !issue.devMode })}
          size="sm"
          variant="outline"
          className={`${badgeButtonBase} cursor-pointer ${
            issue.devMode
              ? 'border-amber-400/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'border-border/50 bg-muted/20 text-muted-foreground/60 hover:text-muted-foreground'
          }`}
          title={t('issue.devMode')}
        >
          <Bug className="h-3 w-3" />
          <span>{t('issue.dev')}</span>
        </Button>
        <span
          className={`${badgeBase} border-border/50 bg-muted/20 text-muted-foreground/80`}
        >
          <Calendar className="h-3 w-3" />
          {formatDate(issue.createdAt, i18n.language)}
        </span>
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
        onClick={() => setOpen((v) => !v)}
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
      {open ? (
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
      ) : null}
    </div>
  )
}

export function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority
  onChange: (p: Priority) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative flex">
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        size="sm"
        variant="outline"
        className={`${badgeButtonBase} border-orange-200/50 dark:border-orange-800/30 bg-orange-50/50 dark:bg-orange-950/20 cursor-pointer transition-colors hover:opacity-80`}
      >
        <PriorityIcon priority={value} className="h-3 w-3" />
        {tPriority(t, value)}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>
      {open ? (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 min-w-[110px] rounded-xl border border-border/60 bg-popover/95 backdrop-blur-sm py-1 shadow-xl text-xs text-popover-foreground">
          {PRIORITIES.map((p) => {
            const isActive = p === value
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  if (p !== value) onChange(p)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                  isActive ? 'bg-primary/10 font-medium' : 'hover:bg-accent/50'
                }`}
              >
                <PriorityIcon priority={p} className="h-3 w-3" />
                {tPriority(t, p)}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
