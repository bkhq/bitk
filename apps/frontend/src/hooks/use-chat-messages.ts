import type {
  AssistantChatMessage,
  ChatMessage,
  ErrorChatMessage,
  NormalizedLogEntry,
  SystemChatMessage,
  TaskPlanChatMessage,
  ThinkingChatMessage,
  ToolGroupChatMessage,
  ToolGroupItem,
  UserChatMessage,
} from '@bkd/shared'
import { useMemo } from 'react'

// ---------- Helpers ----------

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

function getToolName(entry: NormalizedLogEntry): string | undefined {
  return (
    entry.toolDetail?.toolName ??
    (entry.metadata?.toolName as string | undefined)
  )
}

function isTodoWriteEntry(entry: NormalizedLogEntry): boolean {
  return getToolName(entry) === 'TodoWrite'
}

function entryId(entry: NormalizedLogEntry, fallback: string): string {
  return entry.messageId ?? fallback
}

// ---------- TodoWrite → TaskPlan ----------

function extractTodos(
  entry: NormalizedLogEntry,
): TaskPlanChatMessage['todos'] | null {
  const meta = entry.metadata
  if (!meta) return null
  const args = (meta.arguments ?? meta.input) as
    | {
        todos?: Array<{ content: string; status: string; activeForm?: string }>
      }
    | undefined
  if (!args?.todos || !Array.isArray(args.todos)) return null
  return args.todos.map((t) => ({
    content: t.content ?? '',
    status: t.status ?? 'pending',
    activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
  }))
}

// ---------- Main rebuild ----------

function rebuildMessages(entries: NormalizedLogEntry[]): ChatMessage[] {
  // Local counter — avoids module-level singleton race when multiple
  // components call useChatMessages concurrently.
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  const messages: ChatMessage[] = []
  let toolBuffer: ToolGroupItem[] = []
  // Deferred thinking entry — consumed by the next tool group as its description,
  // or flushed as a standalone thinking message if no tool calls follow.
  let pendingThinking: { content: string; entry: NormalizedLogEntry } | null =
    null

  // Build turn → duration map from system-message metadata
  const turnDuration = new Map<number, number>()
  for (const entry of entries) {
    if (
      entry.entryType === 'system-message' &&
      typeof entry.metadata?.duration === 'number'
    ) {
      turnDuration.set(entry.turnIndex ?? 0, entry.metadata.duration as number)
    }
  }

  // Build result lookup: toolCallId → entry
  const resultMap = new Map<string, NormalizedLogEntry>()
  // Track which results get paired with an action
  const pairedResultCallIds = new Set<string>()
  for (const entry of entries) {
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ??
        (entry.metadata?.toolCallId as string | undefined)
      if (callId) resultMap.set(callId, entry)
    }
  }

  // Pre-build command_output index: for each command user-message index,
  // find the next command_output system-message. This avoids O(n) indexOf
  // inside the main loop and prevents cross-command mismatches.
  const commandOutputByIdx = new Map<number, number>()
  const consumedOutputIdx = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.entryType === 'user-message' && e.metadata?.type === 'command') {
      for (let j = i + 1; j < entries.length; j++) {
        const c = entries[j]
        if (
          c.entryType === 'system-message' &&
          c.metadata?.subtype === 'command_output' &&
          !consumedOutputIdx.has(j)
        ) {
          commandOutputByIdx.set(i, j)
          consumedOutputIdx.add(j)
          break
        }
      }
    }
  }

  function buildToolGroup(
    items: ToolGroupItem[],
    description?: string,
  ): ToolGroupChatMessage {
    const stats: Record<string, number> = {}
    for (const item of items) {
      const kind =
        item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
      stats[kind] = (stats[kind] ?? 0) + 1
    }
    return {
      type: 'tool-group',
      id: nextId('tg'),
      items,
      stats,
      count: items.length,
      hiddenCount: 0,
      description,
    }
  }

  function flushPendingThinking(): void {
    if (!pendingThinking) return
    messages.push({
      type: 'thinking',
      id: entryId(pendingThinking.entry, nextId('th')),
      entry: pendingThinking.entry,
    } satisfies ThinkingChatMessage)
    pendingThinking = null
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return

    const todoItems = toolBuffer.filter((item) => isTodoWriteEntry(item.action))
    const nonTodoItems = toolBuffer.filter(
      (item) => !isTodoWriteEntry(item.action),
    )

    // Save thinking before task-plan flush so non-todo tools can still use it
    const savedThinking = pendingThinking

    if (todoItems.length > 0) {
      const lastTodo = todoItems[todoItems.length - 1]
      const todos = extractTodos(lastTodo.action)
      if (todos) {
        if (nonTodoItems.length === 0) {
          // No other tools to absorb thinking — flush it as standalone
          flushPendingThinking()
        }
        messages.push({
          type: 'task-plan',
          id: entryId(lastTodo.action, nextId('tp')),
          entry: lastTodo.action,
          todos,
          completedCount: todos.filter((t) => t.status === 'completed').length,
        } satisfies TaskPlanChatMessage)
      }
    }

    if (nonTodoItems.length > 0) {
      // Consume deferred thinking as tool group description
      const desc = savedThinking?.content
      pendingThinking = null
      messages.push(buildToolGroup(nonTodoItems, desc))
    } else if (pendingThinking) {
      // No tool items consumed the thinking — flush it as standalone
      flushPendingThinking()
    }

    toolBuffer = []
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Skip result entries that were paired with their action
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ??
        (entry.metadata?.toolCallId as string | undefined)
      if (callId && pairedResultCallIds.has(callId)) continue
      // Unpaired result (action not in this slice) — render as standalone
      flushToolBuffer()
      toolBuffer.push({ action: entry, result: null })
      flushToolBuffer()
      continue
    }

    if (isToolUseAction(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ??
        (entry.metadata?.toolCallId as string | undefined)
      let result: NormalizedLogEntry | null = null
      if (callId) {
        result = resultMap.get(callId) ?? null
        if (result) pairedResultCallIds.add(callId)
      }
      toolBuffer.push({ action: entry, result })
      continue
    }

    // Non-tool entry → flush pending tool buffer + any unconsumed thinking
    flushToolBuffer()

    switch (entry.entryType) {
      case 'user-message': {
        flushPendingThinking()
        const metaType = entry.metadata?.type as string | undefined
        const attachments = (entry.metadata?.attachments ?? []) as Array<{
          id: string
          name: string
          mimeType: string
          size: number
        }>
        const status =
          metaType === 'pending'
            ? 'pending'
            : metaType === 'done'
              ? 'done'
              : metaType === 'command'
                ? 'command'
                : 'normal'
        const msg: UserChatMessage = {
          type: 'user',
          id: entryId(entry, nextId('um')),
          entry,
          attachments,
          status: status as UserChatMessage['status'],
        }
        // Pair command user-messages with their pre-indexed command_output
        if (status === 'command') {
          const outputIdx = commandOutputByIdx.get(i)
          if (outputIdx !== undefined) {
            msg.commandOutput = entries[outputIdx]
          }
        }
        messages.push(msg)
        break
      }

      case 'assistant-message':
        flushPendingThinking()
        messages.push({
          type: 'assistant',
          id: entryId(entry, nextId('am')),
          entry,
          durationMs: turnDuration.get(entry.turnIndex ?? 0),
        } satisfies AssistantChatMessage)
        break

      case 'thinking':
        // Defer: if the next entries are tool calls, this becomes the tool group
        // description; otherwise it will be flushed as a standalone thinking message
        flushPendingThinking()
        pendingThinking = entry.content
          ? { content: entry.content, entry }
          : null
        if (!pendingThinking) {
          messages.push({
            type: 'thinking',
            id: entryId(entry, nextId('th')),
            entry,
          } satisfies ThinkingChatMessage)
        }
        break

      case 'system-message': {
        // Skip command_output entries consumed by command user-messages
        if (consumedOutputIdx.has(i)) break
        flushPendingThinking()
        messages.push({
          type: 'system',
          id: entryId(entry, nextId('sys')),
          entry,
          subtype: (entry.metadata?.subtype as string | undefined) ?? 'info',
        } satisfies SystemChatMessage)
        break
      }

      case 'error-message':
        flushPendingThinking()
        messages.push({
          type: 'error',
          id: entryId(entry, nextId('err')),
          entry,
        } satisfies ErrorChatMessage)
        break

      case 'token-usage':
      case 'loading':
        break

      default:
        break
    }
  }

  flushToolBuffer()
  flushPendingThinking()
  return messages
}

// ---------- Hook ----------

interface ChatMessagesResult {
  messages: ChatMessage[]
  pendingMessages: ChatMessage[]
}

/**
 * Transform flat NormalizedLogEntry[] into grouped ChatMessage[].
 * Frontend equivalent of the backend MessageRebuilder.
 * Pending messages are extracted and returned separately for bottom-pinned display.
 */
export function useChatMessages(
  logs: NormalizedLogEntry[],
): ChatMessagesResult {
  return useMemo(() => {
    const all = rebuildMessages(logs)
    const messages: ChatMessage[] = []
    const pendingMessages: ChatMessage[] = []
    for (const msg of all) {
      if (
        msg.type === 'user' &&
        (msg.status === 'pending' || msg.status === 'done')
      ) {
        pendingMessages.push(msg)
      } else {
        messages.push(msg)
      }
    }
    return { messages, pendingMessages }
  }, [logs])
}
