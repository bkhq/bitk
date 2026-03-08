import type {
  ChatMessage,
  NormalizedLogEntry,
  ToolGroupChatMessage,
  ToolGroupItem,
} from '@bkd/shared'
import DOMPurify from 'dompurify'
import { ChevronRight, FileEdit, FileText, Wrench } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useTheme } from '@/hooks/use-theme'
import { getCommandPreview } from '@/lib/command-preview'
import { codeToHtml } from '@/lib/shiki'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'

const LazyMultiFileDiff = lazy(() =>
  import('@pierre/diffs/react').then((m) => ({ default: m.MultiFileDiff })),
)

// ── Shared UI primitives ─────────────────────────────────

function stringifyPretty(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

interface ParsedFileToolInput {
  filePath?: string
  content?: string
  oldString?: string
  newString?: string
  hasOnlyFilePath: boolean
  raw: string
}

function parseFileToolInput(input: unknown): ParsedFileToolInput {
  const raw = stringifyPretty(input)
  if (!input || typeof input !== 'object') {
    return { hasOnlyFilePath: false, raw }
  }
  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj)
  const hasOnlyFilePath = keys.length === 1 && keys[0] === 'file_path'
  return {
    filePath: typeof obj.file_path === 'string' ? obj.file_path : undefined,
    content: typeof obj.content === 'string' ? obj.content : undefined,
    oldString: typeof obj.old_string === 'string' ? obj.old_string : undefined,
    newString: typeof obj.new_string === 'string' ? obj.new_string : undefined,
    hasOnlyFilePath,
    raw,
  }
}

function detectCodeLanguage(filePath?: string): string {
  if (!filePath) return 'text'
  const p = filePath.toLowerCase()
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.tsx')) return 'tsx'
  if (p.endsWith('.js')) return 'javascript'
  if (p.endsWith('.jsx')) return 'jsx'
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'markdown'
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html'
  if (p.endsWith('.css')) return 'css'
  if (p.endsWith('.py')) return 'python'
  if (p.endsWith('.sql')) return 'sql'
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml'
  if (p.endsWith('.xml')) return 'xml'
  if (p.endsWith('.go')) return 'go'
  if (p.endsWith('.rs')) return 'rust'
  if (p.endsWith('.sh') || p.endsWith('.bash') || p.endsWith('.zsh'))
    return 'shell'
  if (p.endsWith('.toml')) return 'toml'
  if (p.endsWith('.dockerfile') || p.includes('Dockerfile')) return 'dockerfile'
  return 'text'
}

function ShikiCodeBlock({
  content,
  language = 'text',
  maxHeightClass,
}: {
  content: string
  language?: string
  maxHeightClass: string
}) {
  const [html, setHtml] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void codeToHtml(content, language).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [content, language])

  if (!html) {
    return (
      <pre
        className={`code-surface ${maxHeightClass} overflow-auto rounded-md p-2 text-[12px] leading-[1.45] font-mono`}
      >
        {content}
      </pre>
    )
  }

  return (
    <div
      className={`code-surface shiki-block ${maxHeightClass} overflow-auto rounded-md`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via DOMPurify.sanitize()
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}

function CodeBlock({
  content,
  language = 'text',
  collapsible = false,
}: {
  content: string
  language?: string
  collapsible?: boolean
}) {
  const value = content || '(empty)'
  const maxHeightClass = collapsible ? 'max-h-64' : 'max-h-80'
  return (
    <ShikiCodeBlock
      content={value}
      language={language}
      maxHeightClass={maxHeightClass}
    />
  )
}

function ShikiUnifiedDiff({
  original,
  modified,
  filePath,
}: {
  original: string
  modified: string
  filePath?: string
}) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const name = filePath ?? 'file'

  return (
    <div className="overflow-x-auto rounded-md border border-border/40">
      <Suspense
        fallback={
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
            {t('common.loading')}
          </div>
        }
      >
        <LazyMultiFileDiff
          oldFile={{ name, contents: original }}
          newFile={{ name, contents: modified }}
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
  )
}

function ToolPanel({
  summary,
  children,
  collapsible = false,
}: {
  summary: React.ReactNode
  children: React.ReactNode
  collapsible?: boolean
}) {
  if (collapsible) {
    return (
      <details className="group/panel rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
        <summary className="cursor-pointer list-none px-2.5 py-1.5 transition-colors hover:bg-muted/20">
          {summary}
        </summary>
        <div className="px-2.5 pb-2.5 pt-1.5 border-t border-border/20">
          {children}
        </div>
      </details>
    )
  }
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10">
      <div className="px-2.5 py-1.5">{summary}</div>
      <div className="px-2.5 pb-2.5 pt-1.5 border-t border-border/20">
        {children}
      </div>
    </div>
  )
}

// ── Single tool item renderers ───────────────────────────

function FileToolItem({ item }: { item: ToolGroupItem }) {
  const actionEntry = item.action
  const tool = actionEntry.toolAction
  const isEdit = tool?.kind === 'file-edit'
  const toolName =
    typeof actionEntry.metadata?.toolName === 'string'
      ? actionEntry.metadata.toolName
      : undefined
  const isWrite = toolName === 'Write'
  const filePath = tool && 'path' in tool ? tool.path : 'unknown'
  const codeLanguage = detectCodeLanguage(filePath)
  const parsed = parseFileToolInput(actionEntry.metadata?.input)
  const hasContent = parsed.content !== undefined
  const hasOldString = parsed.oldString !== undefined
  const hasNewString = parsed.newString !== undefined

  if (!isEdit) {
    return (
      <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0 text-blue-500" />
        <span className="font-mono truncate">File Read: {filePath}</span>
      </div>
    )
  }

  return (
    <ToolPanel
      collapsible
      summary={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileEdit className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="font-mono truncate">
            {isWrite ? 'File Write' : 'File Edit'}: {filePath}
          </span>
        </div>
      }
    >
      <div className="space-y-2">
        {hasContent ? (
          <CodeBlock
            content={parsed.content!}
            language={codeLanguage}
            collapsible={false}
          />
        ) : null}

        {hasOldString ? (
          hasNewString ? (
            <ShikiUnifiedDiff
              original={parsed.oldString || ''}
              modified={parsed.newString || ''}
              filePath={filePath}
            />
          ) : (
            <CodeBlock
              content={parsed.oldString || ''}
              language={codeLanguage}
              collapsible={false}
            />
          )
        ) : null}

        {!hasOldString && hasNewString ? (
          <CodeBlock
            content={parsed.newString || ''}
            language={codeLanguage}
            collapsible={false}
          />
        ) : null}

        {!hasContent &&
        !hasOldString &&
        !hasNewString &&
        !parsed.hasOnlyFilePath ? (
          <CodeBlock
            content={parsed.raw || '(empty)'}
            language="json"
            collapsible={false}
          />
        ) : null}
      </div>
    </ToolPanel>
  )
}

function CommandToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const fullCommand =
    item.action.toolAction?.kind === 'command-run'
      ? item.action.toolAction.command
      : ''
  const isTruncatedInTitle = getCommandPreview(fullCommand, 90).isTruncated
  const showFullCommand = isTruncatedInTitle || fullCommand.includes('\n')

  return (
    <ToolPanel
      collapsible
      summary={<LogEntry entry={item.action} inToolGroup />}
    >
      <div className="space-y-2">
        {showFullCommand ? (
          <div className="rounded-md border border-border/30 bg-muted/10 p-2 space-y-1">
            <div className="px-0.5 text-[11px] text-muted-foreground">
              {t('session.tool.fullCommand')}
            </div>
            <CodeBlock
              content={fullCommand}
              language="shell"
              collapsible={false}
            />
          </div>
        ) : null}
        <CodeBlock
          content={item.result?.content || item.action.content || '(empty)'}
          collapsible={false}
        />
      </div>
    </ToolPanel>
  )
}

function GenericToolItem({ item }: { item: ToolGroupItem }) {
  return (
    <ToolPanel
      collapsible
      summary={<LogEntry entry={item.action} inToolGroup />}
    >
      <CodeBlock
        content={item.result?.content || item.action.content || '(empty)'}
        collapsible={false}
      />
    </ToolPanel>
  )
}

// ── ToolGroupMessage — collapsible group of tool calls ───

function getGroupSummaryLabel(
  stats: Record<string, number>,
  count: number,
  t: (key: string) => string,
): string {
  const parts: string[] = []
  if (stats['file-read'])
    parts.push(`${stats['file-read']} ${t('session.tool.fileRead')}`)
  if (stats['file-edit'])
    parts.push(`${stats['file-edit']} ${t('session.tool.fileEdit')}`)
  if (stats['command-run'])
    parts.push(`${stats['command-run']} ${t('session.tool.commandRun')}`)
  if (stats.search) parts.push(`${stats.search} ${t('session.tool.search')}`)
  if (stats['web-fetch'])
    parts.push(`${stats['web-fetch']} ${t('session.tool.webFetch')}`)
  const otherCount =
    count - Object.values(stats).reduce((a, b) => a + b, 0) + (stats.other ?? 0)
  if (otherCount > 0) parts.push(`${otherCount} other`)
  return parts.length > 0 ? parts.join(', ') : `${count} tool calls`
}

function ToolGroupMessage({ message }: { message: ToolGroupChatMessage }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { items, stats, count } = message
  const summaryLabel = getGroupSummaryLabel(stats, count, t)

  return (
    <div className="py-0.5 animate-message-enter">
      <div className="rounded-lg border border-border/30 bg-muted/10">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="truncate">{summaryLabel}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            {count}
          </span>
        </button>
        {expanded ? (
          <div className="space-y-1 px-2.5 pb-2.5 pt-1 border-t border-border/20">
            {items.map((item, idx) => {
              const kind = item.action.toolAction?.kind
              if (kind === 'file-edit' || kind === 'file-read') {
                return (
                  <FileToolItem
                    key={item.action.messageId ?? `ti-${idx}`}
                    item={item}
                  />
                )
              }
              if (kind === 'command-run') {
                return (
                  <CommandToolItem
                    key={item.action.messageId ?? `ti-${idx}`}
                    item={item}
                  />
                )
              }
              return (
                <GenericToolItem
                  key={item.action.messageId ?? `ti-${idx}`}
                  item={item}
                />
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── ChatMessage renderer ─────────────────────────────────

function ChatMessageRow({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'user': {
      // Command user-messages get special rendering
      if (message.status === 'command') {
        return (
          <div key={message.id} className="group py-1.5 animate-message-enter">
            <details className="rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
                <code className="font-mono text-foreground/70">
                  {message.entry.content}
                </code>
              </summary>
              {message.commandOutput ? (
                <div className="px-3 pb-3 pt-1.5 border-t border-border/20">
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                    {message.commandOutput.content}
                  </pre>
                </div>
              ) : null}
            </details>
          </div>
        )
      }
      return <LogEntry key={message.id} entry={message.entry} />
    }

    case 'assistant':
      return (
        <LogEntry
          key={message.id}
          entry={message.entry}
          durationMs={message.durationMs}
        />
      )

    case 'tool-group':
      return <ToolGroupMessage key={message.id} message={message} />

    case 'task-plan':
      return <LogEntry key={message.id} entry={message.entry} />

    case 'thinking':
      return <LogEntry key={message.id} entry={message.entry} />

    case 'system':
      return <LogEntry key={message.id} entry={message.entry} />

    case 'error':
      return <LogEntry key={message.id} entry={message.entry} />

    default:
      return null
  }
}

// ── SessionMessages (main export) ────────────────────────

export function SessionMessages({
  logs,
  scrollRef,
  isRunning = false,
  workingStep,
  onCancel,
  isCancelling = false,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore((s) => s.fullWidthChat)

  // Transform flat entries → grouped ChatMessage[]
  const messages = useChatMessages(logs)

  // Auto-scroll to bottom on new messages appended at the end.
  const nearBottomRef = useRef(true)
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const handler = () => {
      nearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 150
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [scrollRef])

  // Scroll to bottom on initial load
  const initialScrollDone = useRef(false)
  useEffect(() => {
    if (initialScrollDone.current || messages.length === 0) return
    const el = scrollRef?.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight })
      initialScrollDone.current = true
    }
  }, [messages.length, scrollRef])

  const prevLenRef = useRef(messages.length)
  const prevFirstIdRef = useRef(messages[0]?.id)
  // biome-ignore lint/correctness/useExhaustiveDependencies: prevLenRef/prevFirstIdRef are stable refs, not needed as dependencies
  useEffect(() => {
    if (!initialScrollDone.current) return
    const firstId = messages[0]?.id
    const wasOlderPrepend =
      messages.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstId !== prevFirstIdRef.current

    if (
      !wasOlderPrepend &&
      nearBottomRef.current &&
      (messages.length !== prevLenRef.current || isRunning)
    ) {
      const el = scrollRef?.current
      el?.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      })
    }
    prevLenRef.current = messages.length
    prevFirstIdRef.current = firstId
  }, [messages.length, isRunning, scrollRef])

  if (messages.length === 0 && !isRunning) return null

  return (
    <div
      className={`flex flex-col py-2 px-5${fullWidthChat ? '' : ' max-w-4xl'}`}
    >
      {hasOlderLogs && onLoadOlder ? (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={isLoadingOlder}
            className="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingOlder ? t('common.loading') : t('session.loadMore')}
          </button>
        </div>
      ) : null}
      {messages.map((msg) => (
        <ChatMessageRow key={msg.id} message={msg} />
      ))}
      {isRunning ? (
        <div className="flex items-center gap-2.5 my-2 px-3 py-2 text-xs text-muted-foreground animate-message-enter">
          <span className="thinking-dots flex items-center gap-[3px] text-violet-500/70 dark:text-violet-400/70">
            <span />
            <span />
            <span />
          </span>
          <span className="font-medium text-violet-500/70 dark:text-violet-400/70">
            {isCancelling ? t('session.cancelling') : t('session.thinking')}
          </span>
          {!isCancelling && workingStep ? (
            <span className="truncate text-[11px] text-muted-foreground/60 italic">
              {workingStep}
            </span>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="ml-auto rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
