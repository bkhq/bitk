import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Code,
  FileEdit,
  FileText,
  Globe,
  Image,
  ListTodo,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedLogEntry, ToolAction } from '@/types/kanban'
import { formatFileSize } from '@/lib/format'
import { getCommandPreview } from '@/lib/command-preview'
import { MarkdownContent } from './MarkdownContent'

interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
}

function getToolIcon(action?: ToolAction) {
  if (!action) return { Icon: Wrench, color: 'text-muted-foreground' }
  switch (action.kind) {
    case 'file-read':
      return { Icon: FileText, color: 'text-blue-500' }
    case 'file-edit':
      return { Icon: FileEdit, color: 'text-amber-500' }
    case 'command-run':
      return { Icon: Terminal, color: 'text-green-500' }
    case 'search':
      return { Icon: Search, color: 'text-purple-500' }
    case 'web-fetch':
      return { Icon: Globe, color: 'text-cyan-500' }
    default:
      return { Icon: Wrench, color: 'text-muted-foreground' }
  }
}

function getToolLabel(
  action: ToolAction | undefined,
  toolName: string | undefined,
  t: (key: string) => string,
) {
  if (!action) return ''
  switch (action.kind) {
    case 'file-read':
      return `${t('session.tool.fileRead')}: ${action.path}`
    case 'file-edit':
      if (toolName === 'Write')
        return `${t('session.tool.fileWrite')}: ${action.path}`
      return `${t('session.tool.fileEdit')}: ${action.path}`
    case 'command-run': {
      const summary = getCommandPreview(action.command, 90).summary
      return `${t('session.tool.commandRun')}: ${summary}`
    }
    case 'search':
      return `${t('session.tool.search')}: ${action.query}`
    case 'web-fetch':
      return `${t('session.tool.webFetch')}: ${action.url}`
    case 'tool':
      return action.toolName
    case 'other':
      return action.description
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remainS = Math.round(s % 60)
  return `${m}m${remainS}s`
}

function TaskPlanEntry({ entry }: { entry: NormalizedLogEntry }) {
  const items = (
    entry.metadata?.input as
      | {
          todos?: Array<{
            content: string
            status: string
            activeForm?: string
          }>
        }
      | undefined
  )?.todos
  if (!items || items.length === 0) return null

  const completedCount = items.filter((t) => t.status === 'completed').length

  return (
    <div className="px-5 py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <ListTodo className="h-3 w-3 shrink-0 text-indigo-500" />
        <span className="font-medium">Task Plan</span>
        <span className="text-muted-foreground/50">
          ({completedCount}/{items.length})
        </span>
      </div>
      <div className="ml-4 space-y-0.5">
        {items.map((item) => (
          <div key={item.content} className="flex items-start gap-1.5 text-xs">
            {item.status === 'completed' ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
            ) : item.status === 'in_progress' ? (
              <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin mt-0.5" />
            ) : (
              <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-0.5" />
            )}
            <span
              className={
                item.status === 'completed'
                  ? 'text-muted-foreground/60 line-through'
                  : item.status === 'in_progress'
                    ? 'text-blue-600 dark:text-blue-400'
                    : ''
              }
            >
              {item.status === 'in_progress'
                ? item.activeForm || item.content
                : item.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LogEntry({
  entry,
  durationMs,
  inToolGroup = false,
}: {
  entry: NormalizedLogEntry
  durationMs?: number
  inToolGroup?: boolean
}) {
  const { t } = useTranslation()

  switch (entry.entryType) {
    case 'user-message': {
      const isPending = entry.metadata?.pending === true
      const isDone = entry.metadata?.done === true
      const messageAttachments = (entry.metadata?.attachments ??
        []) as AttachmentMeta[]
      // Skip empty user messages (no text, no attachments, not pending/done)
      if (
        !entry.content.trim() &&
        messageAttachments.length === 0 &&
        !isPending &&
        !isDone
      )
        return null
      const barColor = isPending
        ? 'border-amber-400 bg-amber-500/[0.06]'
        : isDone
          ? 'border-emerald-400 bg-emerald-500/[0.06]'
          : 'border-foreground/70'
      return (
        <div className="group px-5 py-2 animate-message-enter">
          <div
            className={`bg-muted/70 px-3 py-2.5 border-l-[3px] max-w-[72ch] ${barColor}`}
          >
            {entry.content.trim() ? (
              <div className="text-[15px] whitespace-pre-wrap break-words text-foreground leading-[1.75]">
                {entry.content}
              </div>
            ) : null}
            {messageAttachments.length > 0 ? (
              <div
                className={`flex flex-wrap gap-1.5${entry.content.trim() ? ' mt-2' : ''}`}
              >
                {messageAttachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {att.mimeType.startsWith('image/') ? (
                      <Image className="h-3 w-3 shrink-0 text-blue-500" />
                    ) : (
                      <FileText className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate max-w-[120px]">{att.name}</span>
                    <span className="text-muted-foreground/50">
                      {formatFileSize(att.size)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
            {isPending || isDone ? (
              <div className="flex items-center gap-2 mt-1">
                {isPending ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-500/70">
                    <Clock className="h-2.5 w-2.5" />
                    {t('chat.pendingMessage')}
                  </span>
                ) : null}
                {isDone ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500/70">
                    {t('chat.doneMessage')}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    case 'assistant-message':
      if (!entry.content.trim()) return null
      return (
        <AssistantMessage
          content={entry.content}
          timestamp={entry.timestamp}
          durationMs={durationMs}
        />
      )

    case 'tool-use': {
      // Render structured task plan for TodoWrite
      const isTodoWrite =
        (entry.toolDetail?.toolName === 'TodoWrite' ||
          entry.metadata?.toolName === 'TodoWrite') &&
        !entry.toolDetail?.isResult &&
        !entry.metadata?.isResult
      if (isTodoWrite) {
        return <TaskPlanEntry entry={entry} />
      }

      const { Icon, color } = getToolIcon(entry.toolAction)
      const toolName =
        typeof entry.metadata?.toolName === 'string'
          ? entry.metadata.toolName
          : undefined
      const label = getToolLabel(entry.toolAction, toolName, t)
      const isResult = entry.metadata?.isResult === true
      if (inToolGroup) {
        if (isResult) return null
        const isCommandTitle = entry.toolAction?.kind === 'command-run'
        const commandSummary =
          entry.toolAction?.kind === 'command-run'
            ? getCommandPreview(entry.toolAction.command, 90).summary
            : ''
        return (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <Icon className={`h-3 w-3 shrink-0 ${color}`} />
            {isCommandTitle ? (
              <div className="min-w-0 flex-1 truncate">
                <span>{t('session.tool.commandRun')}: </span>
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                  {commandSummary}
                </code>
              </div>
            ) : (
              <span className="truncate font-mono">
                {label || entry.content}
              </span>
            )}
          </div>
        )
      }
      return (
        <div className="px-5 py-0.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className={`h-3 w-3 shrink-0 ${color}`} />
            <span className="truncate font-mono">{label || entry.content}</span>
          </div>
        </div>
      )
    }

    case 'system-message':
      // Show concise, actionable system events and suppress noisy internals.
      if (!entry.content.trim()) return null
      if (entry.metadata?.subtype === 'init') return null
      if (entry.metadata?.subtype === 'hook_response') return null
      if (entry.metadata?.subtype === 'hook_started') return null
      if (entry.metadata?.subtype === 'hook_completed') return null
      if (entry.metadata?.source === 'result') return null
      if (typeof entry.metadata?.duration === 'number') return null
      return (
        <div className="flex items-center gap-2 px-5 py-0.5 text-[11px] text-muted-foreground/60">
          <span className="truncate">{entry.content}</span>
        </div>
      )

    case 'error-message':
      return (
        <div className="flex gap-2 mx-5 my-1.5 rounded-lg bg-destructive/[0.06] border border-destructive/20 px-3 py-2 animate-message-enter">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
          <p className="text-xs text-destructive/90 break-words leading-relaxed">
            {entry.content}
          </p>
        </div>
      )

    case 'thinking':
      return (
        <div className="px-5 py-0.5">
          <span className="text-xs text-violet-500/70 dark:text-violet-400/70 italic">
            Thinking: {entry.content}
          </span>
        </div>
      )

    case 'loading':
      return (
        <div className="flex items-center gap-2 px-5 py-0.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary/50" />
          <span>{entry.content}</span>
        </div>
      )

    case 'token-usage':
      return null

    default:
      return null
  }
}

function AssistantMessage({
  content,
  timestamp,
  durationMs,
}: {
  content: string
  timestamp?: string
  durationMs?: number
}) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState(false)

  return (
    <div className="group px-5 py-1.5 animate-message-enter">
      <div className="min-w-0 max-w-[72ch]">
        {raw ? (
          <pre className="text-[14px] whitespace-pre-wrap break-words font-mono leading-relaxed">
            {content}
          </pre>
        ) : (
          <MarkdownContent
            content={content}
            className="text-[14px] leading-[1.75]"
          />
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {timestamp ? (
          <span className="text-[10px] text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors duration-200">
            {formatTime(timestamp)}
          </span>
        ) : null}
        {durationMs != null ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/40">
            <Clock className="h-2.5 w-2.5" />
            {t('session.duration', { time: formatDuration(durationMs) })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          className={`h-4 w-4 shrink-0 rounded transition-all duration-200 ${
            raw
              ? 'text-foreground'
              : 'text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-muted-foreground'
          }`}
          title={raw ? 'Markdown' : 'Source'}
        >
          <Code className="h-3 w-3 mx-auto" />
        </button>
      </div>
    </div>
  )
}
