import type { ChatMessage, NormalizedLogEntry, TaskPlanChatMessage } from '@bkd/shared'
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'

// ── ChatMessage renderer ─────────────────────────────────

function ChatMessageRow({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'user': {
      if (message.status === 'command') {
        return (
          <div className="group py-1.5 animate-message-enter">
            <details className="rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
                <code className="font-mono text-foreground/70">{message.entry.content}</code>
              </summary>
              {message.commandOutput ?
                  (
                    <div className="px-3 pb-3 pt-1.5 border-t border-border/20">
                      <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                        {message.commandOutput.content}
                      </pre>
                    </div>
                  ) :
                null}
            </details>
          </div>
        )
      }
      return <LogEntry entry={message.entry} />
    }

    case 'assistant':
      return <LogEntry entry={message.entry} durationMs={message.durationMs} />

    case 'tool-group':
      return <ToolGroupMessage message={message} />

    case 'task-plan':
      return <TaskPlanMessage message={message as TaskPlanChatMessage} />

    case 'thinking':
    case 'system':
    case 'error':
      return <LogEntry entry={message.entry} />

    default:
      return null
  }
}

// ── Task Plan ────────────────────────────────────────────

function TaskPlanMessage({ message }: { message: TaskPlanChatMessage }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { todos, completedCount } = message

  const inProgressItem = todos.find(it => it.status === 'in_progress')
  const statusText = inProgressItem ? inProgressItem.activeForm || inProgressItem.content : null

  return (
    <div className="animate-message-enter">
      <div className="rounded-lg border border-border/40 bg-background/95 shadow-sm">
        {/* Compact status bar */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/20"
        >
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="font-medium text-muted-foreground">{t('session.tool.taskPlan')}</span>
          <span className="text-muted-foreground/50">
            (
            {completedCount}
            /
            {todos.length}
            )
          </span>
          {statusText ?
              (
                <span className="truncate text-blue-600 dark:text-blue-400">{statusText}</span>
              ) :
            null}
          <ChevronDown
            className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Expandable detail panel — opens downward */}
        {expanded ?
            (
              <div className="px-3 pb-2 pt-1 space-y-0.5 border-t border-border/20">
                {todos.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-xs">
                    {item.status === 'completed' ?
                        (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                        ) :
                      item.status === 'in_progress' ?
                          (
                            <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin mt-0.5" />
                          ) :
                          (
                            <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-0.5" />
                          )}
                    <span
                      className={
                        item.status === 'completed' ?
                          'text-muted-foreground/60 line-through' :
                          item.status === 'in_progress' ?
                            'text-blue-600 dark:text-blue-400' :
                            ''
                      }
                    >
                      {item.status === 'in_progress' ? item.activeForm || item.content : item.content}
                    </span>
                  </div>
                ))}
              </div>
            ) :
          null}
      </div>
    </div>
  )
}

// ── SessionMessages (main export) ────────────────────────

export function SessionMessages({
  logs,
  scrollRef,
  isRunning = false,
  workingStep,
  onCancel,
  onEditPending,
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
  onEditPending?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)

  // Transform flat entries → grouped ChatMessage[]
  const { messages, pendingMessages } = useChatMessages(logs)

  // Auto-scroll to bottom on new messages
  const nearBottomRef = useRef(true)
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const handler = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [scrollRef])

  const initialScrollDone = useRef(false)
  useEffect(() => {
    if (initialScrollDone.current || (messages.length === 0 && pendingMessages.length === 0)) return
    const el = scrollRef?.current
    if (!el) return
    // Double-rAF ensures the lazy-loaded content has been painted before
    // we measure scrollHeight.  A single rAF fires before the browser
    // composites the first meaningful paint of the Suspense child.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight })
        initialScrollDone.current = true
      })
    })
  }, [messages.length, pendingMessages.length, scrollRef])

  const prevLenRef = useRef(messages.length)
  const prevFirstIdRef = useRef(messages[0]?.id)

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

  if (messages.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  return (
    <div className={`flex flex-col py-2 px-5${fullWidthChat ? '' : ' max-w-4xl'}`}>
      {hasOlderLogs && onLoadOlder ?
          (
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
          ) :
        null}
      {messages.map(msg => (
        <ChatMessageRow key={msg.id} message={msg} />
      ))}
      {isRunning ?
          (
            <div className="flex items-center gap-2.5 my-2 px-3 py-2 text-xs text-muted-foreground animate-message-enter">
              <span className="thinking-dots flex items-center gap-[3px] text-violet-500/70 dark:text-violet-400/70">
                <span />
                <span />
                <span />
              </span>
              <span className="font-medium text-violet-500/70 dark:text-violet-400/70">
                {isCancelling ? t('session.cancelling') : t('session.thinking')}
              </span>
              {!isCancelling && workingStep ?
                  (
                    <span className="truncate text-[11px] text-muted-foreground/60 italic">
                      {workingStep}
                    </span>
                  ) :
                null}
              {onCancel ?
                  (
                    <button
                      type="button"
                      onClick={onCancel}
                      disabled={isCancelling}
                      className="ml-auto rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
                    </button>
                  ) :
                null}
            </div>
          ) :
        null}
      {pendingMessages.length > 0 ?
          (
            <div className="mt-1 border-t border-border/30 pt-2">
              {pendingMessages.map(msg => (
                <div key={msg.id} className="group relative">
                  <ChatMessageRow message={msg} />
                  {onEditPending ?
                      (
                        <button
                          type="button"
                          onClick={onEditPending}
                          className="absolute right-2 top-2 hidden rounded-md border border-border/40 bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
                        >
                          {t('common.edit')}
                        </button>
                      ) :
                    null}
                </div>
              ))}
            </div>
          ) :
        null}
    </div>
  )
}
