import type {
  NormalizedLogEntry,
  TaskPlanChatMessage,
  ToolGroupChatMessage,
  ToolGroupItem,
} from '@bkd/shared'
import { useMemo } from 'react'
import { extractTodos } from './use-chat-messages'

export interface AcpTimelineEntryItem {
  type: 'entry'
  id: string
  entry: NormalizedLogEntry
}

export interface AcpTimelinePlanItem {
  type: 'plan'
  id: string
  entry: NormalizedLogEntry
  todos: TaskPlanChatMessage['todos']
  completedCount: number
}

export interface AcpTimelineToolGroupItem {
  type: 'tool-group'
  id: string
  message: ToolGroupChatMessage
}

export type AcpTimelineItem =
  | AcpTimelineEntryItem
  | AcpTimelinePlanItem
  | AcpTimelineToolGroupItem

interface AcpTimelineResult {
  items: AcpTimelineItem[]
  pendingMessages: NormalizedLogEntry[]
}

function entryId(entry: NormalizedLogEntry, fallback: string): string {
  return entry.messageId ?? fallback
}

function hasResultFlag(entry: NormalizedLogEntry): boolean {
  return (
    entry.toolDetail?.isResult === true ||
    (entry.metadata?.isResult as boolean | undefined) === true
  )
}

function isToolUseAction(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'tool-use' && !hasResultFlag(entry)
}

function isToolUseResult(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'tool-use' && hasResultFlag(entry)
}

function shouldHideAcpEntry(entry: NormalizedLogEntry): boolean {
  if (entry.entryType === 'loading' || entry.entryType === 'token-usage') return true

  if (entry.entryType === 'user-message' && entry.metadata?.type === 'system') {
    return true
  }

  if (entry.entryType !== 'system-message') return false

  const subtype = entry.metadata?.subtype
  if (
    subtype === 'init' ||
    subtype === 'task_progress' ||
    subtype === 'stop_hook_summary' ||
    subtype === 'task_notification'
  ) {
    return true
  }

  if (
    entry.content === 'ACP session loaded' ||
    entry.content === 'ACP session started' ||
    entry.content === 'ACP session initialized'
  ) {
    return true
  }

  return false
}

function rebuildAcpTimeline(entries: NormalizedLogEntry[]): AcpTimelineResult {
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  const items: AcpTimelineItem[] = []
  const pendingMessages: NormalizedLogEntry[] = []
  const resultMap = new Map<string, NormalizedLogEntry>()
  const pairedResultCallIds = new Set<string>()

  for (const entry of entries) {
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      if (callId) resultMap.set(callId, entry)
    }
  }

  let pendingStreamingAssistant: NormalizedLogEntry | null = null
  let toolBuffer: ToolGroupItem[] = []

  function buildToolGroup(items: ToolGroupItem[]): ToolGroupChatMessage {
    const stats: Record<string, number> = {}
    for (const item of items) {
      const kind = item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
      stats[kind] = (stats[kind] ?? 0) + 1
    }

    const stableId = items[0]?.action.messageId ?? nextId('acp-tg')
    return {
      type: 'tool-group',
      id: `acp-tg-${stableId}`,
      items,
      stats,
      count: items.length,
      hiddenCount: 0,
    }
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return
    const message = buildToolGroup(toolBuffer)
    items.push({
      type: 'tool-group',
      id: message.id,
      message,
    })
    toolBuffer = []
  }

  function flushStreamingAssistant(): void {
    if (!pendingStreamingAssistant) return
    flushToolBuffer()
    items.push({
      type: 'entry',
      id: entryId(pendingStreamingAssistant, nextId('acp-entry')),
      entry: pendingStreamingAssistant,
    })
    pendingStreamingAssistant = null
  }

  function pushEntry(entry: NormalizedLogEntry): void {
    if (
      entry.entryType === 'user-message' &&
      (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')
    ) {
      pendingMessages.push(entry)
      return
    }

    flushToolBuffer()
    items.push({
      type: 'entry',
      id: entryId(entry, nextId('acp-entry')),
      entry,
    })
  }

  for (const entry of entries) {
    if (shouldHideAcpEntry(entry)) continue

    if (
      entry.entryType === 'assistant-message' &&
      entry.metadata?.streaming === true
    ) {
      if (
        pendingStreamingAssistant &&
        pendingStreamingAssistant.turnIndex === entry.turnIndex
      ) {
        pendingStreamingAssistant = {
          ...pendingStreamingAssistant,
          content: `${pendingStreamingAssistant.content}${entry.content}`,
          timestamp: entry.timestamp ?? pendingStreamingAssistant.timestamp,
        }
      } else {
        flushStreamingAssistant()
        pendingStreamingAssistant = { ...entry }
      }
      continue
    }

    if (
      entry.entryType === 'assistant-message' &&
      pendingStreamingAssistant &&
      pendingStreamingAssistant.turnIndex === entry.turnIndex
    ) {
      pendingStreamingAssistant = null
      pushEntry(entry)
      continue
    }

    flushStreamingAssistant()

    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      if (callId && pairedResultCallIds.has(callId)) continue

      // Flush existing buffer first so orphaned results don't merge
      // with unrelated tool actions that follow
      flushToolBuffer()
      toolBuffer.push({
        action: entry,
        result: null,
      })
      continue
    }

    if (isToolUseAction(entry)) {
      // Flush orphaned results before starting a new action batch
      if (toolBuffer.length > 0 && toolBuffer.some(item => hasResultFlag(item.action))) {
        flushToolBuffer()
      }
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      let result: NormalizedLogEntry | null = null
      if (callId) {
        result = resultMap.get(callId) ?? null
        if (result) pairedResultCallIds.add(callId)
      }
      toolBuffer.push({
        action: entry,
        result,
      })
      continue
    }

    if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'plan') {
      const todos = extractTodos(entry)
      if (todos) {
        flushToolBuffer()
        items.push({
          type: 'plan',
          id: entryId(entry, nextId('acp-plan')),
          entry,
          todos,
          completedCount: todos.filter(todo => todo.status === 'completed').length,
        })
        continue
      }
    }

    pushEntry(entry)
  }

  flushStreamingAssistant()
  flushToolBuffer()

  return { items, pendingMessages }
}

export function useAcpTimeline(logs: NormalizedLogEntry[]): AcpTimelineResult {
  return useMemo(() => rebuildAcpTimeline(logs), [logs])
}
