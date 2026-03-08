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
import type { WriteFilterRule } from '@/engines/write-filter'
import { isToolFiltered } from '@/engines/write-filter'

// ---------- Options ----------

export interface RebuildOptions {
  /** When true, show all entries including filtered tools */
  devMode: boolean
  /** Write filter rules (default: Read/Glob/Grep filtered) */
  filterRules: WriteFilterRule[]
}

// ---------- Helpers ----------

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

function isTodoWriteEntry(entry: NormalizedLogEntry): boolean {
  const name =
    entry.toolDetail?.toolName ??
    (entry.metadata?.toolName as string | undefined)
  return name === 'TodoWrite'
}

function isFilteredTool(
  entry: NormalizedLogEntry,
  rules: WriteFilterRule[],
): boolean {
  const name =
    entry.toolDetail?.toolName ??
    (entry.metadata?.toolName as string | undefined)
  if (!name) return false
  return isToolFiltered(name, rules)
}

// ---------- Tool group builder ----------

function buildToolGroup(
  items: ToolGroupItem[],
  options: RebuildOptions,
  nextId: (prefix: string) => string,
): ToolGroupChatMessage {
  const stats: Record<string, number> = {}
  for (const item of items) {
    const kind =
      item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
    stats[kind] = (stats[kind] ?? 0) + 1
  }

  // Apply write filter: mark items as hidden rather than dropping
  let visibleItems: ToolGroupItem[]
  let hiddenCount = 0

  if (options.devMode) {
    // devMode: show everything
    visibleItems = items
  } else {
    visibleItems = []
    for (const item of items) {
      if (isFilteredTool(item.action, options.filterRules)) {
        hiddenCount++
      } else {
        visibleItems.push(item)
      }
    }
  }

  return {
    type: 'tool-group',
    id: nextId('tg'),
    items: visibleItems,
    stats,
    count: items.length,
    hiddenCount,
  }
}

// ---------- TodoWrite → TaskPlan ----------

function extractTodos(
  entry: NormalizedLogEntry,
): TaskPlanChatMessage['todos'] | null {
  const meta = entry.metadata
  if (!meta) return null

  // TodoWrite arguments contain the todos array
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

// ---------- Main rebuilder ----------

/**
 * Rebuilds structured ChatMessages from a flat array of NormalizedLogEntry[].
 *
 * This is the core transformation function. It:
 * 1. Groups consecutive tool-use entries into ToolGroupChatMessage
 * 2. Pairs tool call ↔ result by toolCallId
 * 3. Extracts TodoWrite calls into TaskPlanChatMessage
 * 4. Applies write filter rules as visibility (hidden count) not drops
 * 5. Maps other entry types to their ChatMessage variants
 *
 * Can be used with entries from ExecutionStore (in-memory) or
 * from disk DB (historical logs).
 */
export function rebuildMessages(
  entries: NormalizedLogEntry[],
  options: RebuildOptions,
): ChatMessage[] {
  // Local counter — avoids module-level singleton issues when
  // rebuildMessages is called concurrently for different executions.
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  const messages: ChatMessage[] = []
  let toolBuffer: ToolGroupItem[] = []

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
  for (const entry of entries) {
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ??
        (entry.metadata?.toolCallId as string | undefined)
      if (callId) resultMap.set(callId, entry)
    }
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return

    // Check if the entire group is just TodoWrite calls
    const todoItems = toolBuffer.filter((item) => isTodoWriteEntry(item.action))
    const nonTodoItems = toolBuffer.filter(
      (item) => !isTodoWriteEntry(item.action),
    )

    // Extract task plan from last TodoWrite in the group
    if (todoItems.length > 0) {
      const lastTodo = todoItems[todoItems.length - 1]
      const todos = extractTodos(lastTodo.action)
      if (todos) {
        messages.push({
          type: 'task-plan',
          id: entryId(lastTodo.action, nextId('tp')),
          entry: lastTodo.action,
          todos,
          completedCount: todos.filter((t) => t.status === 'completed').length,
        } satisfies TaskPlanChatMessage)
      }
    }

    // Build tool group from non-TodoWrite items
    if (nonTodoItems.length > 0) {
      messages.push(buildToolGroup(nonTodoItems, options, nextId))
    }

    toolBuffer = []
  }

  for (const entry of entries) {
    // Skip result entries (they're paired with their action)
    if (isToolUseResult(entry)) continue

    // Tool action: buffer it with its paired result
    if (isToolUseAction(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ??
        (entry.metadata?.toolCallId as string | undefined)
      let result: NormalizedLogEntry | null = null
      if (callId) {
        result = resultMap.get(callId) ?? null
      }
      toolBuffer.push({ action: entry, result })
      continue
    }

    // Non-tool entry → flush any pending tool buffer first
    flushToolBuffer()

    switch (entry.entryType) {
      case 'user-message':
        messages.push({
          type: 'user',
          id: entryId(entry, nextId('um')),
          entry,
          attachments: [],
          status: 'normal',
        } satisfies UserChatMessage)
        break

      case 'assistant-message':
        messages.push({
          type: 'assistant',
          id: entryId(entry, nextId('am')),
          entry,
          durationMs: turnDuration.get(entry.turnIndex ?? 0),
        } satisfies AssistantChatMessage)
        break

      case 'thinking':
        messages.push({
          type: 'thinking',
          id: entryId(entry, nextId('th')),
          entry,
        } satisfies ThinkingChatMessage)
        break

      case 'system-message':
        messages.push({
          type: 'system',
          id: entryId(entry, nextId('sys')),
          entry,
          subtype: (entry.metadata?.subtype as string | undefined) ?? 'info',
        } satisfies SystemChatMessage)
        break

      case 'error-message':
        messages.push({
          type: 'error',
          id: entryId(entry, nextId('err')),
          entry,
        } satisfies ErrorChatMessage)
        break

      case 'token-usage':
        // Token usage entries are metadata, not rendered as messages
        break

      case 'loading':
        // Loading entries are transient, skip
        break

      default:
        // Unknown entry type: render as system message
        messages.push({
          type: 'system',
          id: entryId(entry, nextId('sys')),
          entry,
          subtype: 'unknown',
        } satisfies SystemChatMessage)
        break
    }
  }

  // Flush remaining tool buffer
  flushToolBuffer()

  return messages
}
