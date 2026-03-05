import { classifyCommand } from '@/engines/logs'
import type {
  CommandCategory,
  NormalizedLogEntry,
  ToolAction,
  ToolDetail,
} from '@/engines/types'
import type { WriteFilterRule } from '@/engines/write-filter'

// ---------- Claude JSON types (discriminated union) ----------

/** Top-level message envelope from Claude CLI stdout (stream-json format). */
type ClaudeJson =
  | ClaudeSystem
  | ClaudeAssistant
  | ClaudeUser
  | ClaudeToolUse
  | ClaudeToolResult
  | ClaudeStreamEvent
  | ClaudeResult
  | ClaudeError
  | ClaudeRateLimit

interface ClaudeSystem {
  type: 'system'
  subtype?: string
  session_id?: string
  cwd?: string
  model?: string
  tools?: unknown[]
  apiKeySource?: string
  status?: string
  slash_commands?: string[]
  plugins?: Array<{ name: string; path: string }>
  agents?: string[]
  compact_metadata?: Record<string, unknown>
  output?: string
  hook_name?: string
  message?: string
  content?: string
  timestamp?: string
}

interface ClaudeAssistant {
  type: 'assistant'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  timestamp?: string
}

interface ClaudeUser {
  type: 'user'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  isSynthetic?: boolean
  isReplay?: boolean
  timestamp?: string
}

interface ClaudeToolUse {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
  session_id?: string
  timestamp?: string
}

interface ClaudeToolResult {
  type: 'tool_result'
  tool_use_id?: string
  content?: string | unknown[]
  is_error?: boolean
  session_id?: string
  timestamp?: string
}

interface ClaudeStreamEvent {
  type: 'content_block_delta' | 'content_block_start' | 'content_block_stop'
    | 'message_start' | 'message_delta' | 'message_stop'
  index?: number
  delta?: {
    type?: string
    text?: string
    thinking?: string
  }
  content_block?: ClaudeContentItem
  message?: ClaudeMessage
  usage?: ClaudeUsage
  parent_tool_use_id?: string
  session_id?: string
  uuid?: string
  timestamp?: string
}

interface ClaudeResult {
  type: 'result'
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  num_turns?: number
  session_id?: string
  result?: string
  errors?: unknown[]
  model_usage?: Record<string, { contextWindow?: number }>
  usage?: ClaudeUsage
  timestamp?: string
}

interface ClaudeError {
  type: 'error'
  error?: { type?: string; message?: string }
  message?: string
  timestamp?: string
}

interface ClaudeRateLimit {
  type: 'rate_limit'
  session_id?: string
  rate_limit_info?: Record<string, unknown>
  timestamp?: string
}

// ---------- Message / Content types ----------

interface ClaudeMessage {
  id?: string
  role?: string
  model?: string
  content?: ClaudeContentItem[] | string
  stop_reason?: string
}

type ClaudeContentItem =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id?: string; name?: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id?: string; content?: string | unknown[]; is_error?: boolean }

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  service_tier?: string
}

// ---------- Tool call info (for correlating tool_use → tool_result) ----------

interface ToolCallInfo {
  toolName: string
  input: Record<string, unknown>
  toolCallId: string
}

// ---------- Normalizer ----------

export class ClaudeLogNormalizer {
  private readonly rules: WriteFilterRule[]
  private readonly filteredToolCallIds = new Set<string>()
  /** Map tool_use_id → structured info for follow-up tool_result replacement. */
  private readonly toolMap = new Map<string, ToolCallInfo>()
  /** Model name extracted from first assistant message. */
  private modelName: string | undefined
  /** Last assistant message text (used to deduplicate result.result text). */
  private lastAssistantMessage: string | undefined

  constructor(rules: WriteFilterRule[] = []) {
    this.rules = rules.filter((r) => r.enabled)
  }

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    let data: ClaudeJson
    try {
      data = JSON.parse(rawLine)
    } catch {
      if (rawLine.trim()) {
        return { entryType: 'system-message', content: rawLine }
      }
      return null
    }

    switch (data.type) {
      case 'system':
        return this.parseSystem(data)
      case 'assistant':
        return this.parseAssistant(data)
      case 'user':
        return this.parseUser(data)
      case 'tool_use':
        return this.parseToolUse(data)
      case 'tool_result':
        return this.parseToolResult(data)
      case 'result':
        return this.parseResult(data)
      case 'error':
        return this.parseError(data)
      case 'content_block_delta':
      case 'content_block_start':
      case 'message_start':
      case 'message_delta':
      case 'message_stop':
      case 'content_block_stop':
        return this.parseStreamEvent(data)
      case 'rate_limit':
        return this.parseRateLimit(data)
      default:
        return this.parseUnknown(data as Record<string, unknown>)
    }
  }

  // ---------- System ----------

  private parseSystem(data: ClaudeSystem): NormalizedLogEntry | null {
    switch (data.subtype) {
      case 'init':
        return {
          entryType: 'system-message',
          content: `Session started (${data.cwd ?? 'unknown dir'})`,
          timestamp: data.timestamp,
          metadata: {
            subtype: data.subtype,
            sessionId: data.session_id,
            cwd: data.cwd,
            model: data.model,
            slashCommands: Array.isArray(data.slash_commands)
              ? data.slash_commands
              : [],
          },
        }
      case 'compact_boundary':
        return {
          entryType: 'system-message',
          content: 'Context compacted',
          timestamp: data.timestamp,
          metadata: {
            subtype: data.subtype,
            compactMetadata: data.compact_metadata,
          },
        }
      case 'task_started':
        // Suppress — no user-facing value
        return null
      case 'status':
        if (data.status) {
          return {
            entryType: 'system-message',
            content: data.status,
            timestamp: data.timestamp,
            metadata: { subtype: data.subtype },
          }
        }
        return null
      case 'hook_response':
        if (data.output) {
          return {
            entryType: 'system-message',
            content: data.output,
            timestamp: data.timestamp,
            metadata: { subtype: data.subtype, hookName: data.hook_name },
          }
        }
        return null
      default: {
        const msg = data.message ?? data.content ?? data.subtype ?? ''
        if (!msg) return null
        return {
          entryType: 'system-message',
          content: msg,
          timestamp: data.timestamp,
          metadata: data.subtype ? { subtype: data.subtype } : undefined,
        }
      }
    }
  }

  // ---------- Assistant ----------

  private parseAssistant(
    data: ClaudeAssistant,
  ): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const entries: NormalizedLogEntry[] = []

    // Extract model name from first assistant message
    if (!this.modelName && data.message.model) {
      this.modelName = data.message.model
      entries.push({
        entryType: 'system-message',
        content: `System initialized with model: ${data.message.model}`,
        timestamp: data.timestamp,
      })
    }

    const contentBlocks = Array.isArray(data.message.content)
      ? data.message.content
      : null

    // Text content
    const text = extractTextContent(contentBlocks ?? data.message.content)
    if (text) {
      this.lastAssistantMessage = text
      entries.push({
        entryType: 'assistant-message',
        content: text,
        timestamp: data.timestamp,
        metadata: { messageId: data.message.id },
      })
    }

    // Thinking blocks
    if (contentBlocks) {
      for (const block of contentBlocks) {
        if (block.type === 'thinking' && block.thinking) {
          entries.push({
            entryType: 'thinking',
            content: block.thinking,
            timestamp: data.timestamp,
          })
        }
      }
    }

    // Tool use blocks
    if (contentBlocks) {
      for (const block of contentBlocks) {
        if (block.type !== 'tool_use' || !block.name) continue

        if (this.isFiltered(block.name)) {
          if (block.id) this.filteredToolCallIds.add(block.id)
          continue
        }

        const input = block.input ?? {}
        const toolCallId = block.id ?? ''

        // Register in tool map for later correlation
        if (toolCallId) {
          this.toolMap.set(toolCallId, {
            toolName: block.name,
            input,
            toolCallId,
          })
        }

        entries.push({
          entryType: 'tool-use',
          content: generateToolContent(block.name, input),
          timestamp: data.timestamp,
          metadata: {
            messageId: data.message.id,
            toolName: block.name,
            input,
            toolCallId,
          },
          toolAction: classifyToolAction(block.name, input),
          toolDetail: {
            kind: classifyToolKind(block.name),
            toolName: block.name,
            toolCallId,
            isResult: false,
            raw: input,
          },
        })
      }
    }

    if (entries.length === 0) return null
    return entries
  }

  // ---------- User ----------

  private parseUser(
    data: ClaudeUser,
  ): NormalizedLogEntry | NormalizedLogEntry[] | null {
    // Skip replay messages (historical context from --resume)
    if (data.isReplay) return null

    const contentBlocks = Array.isArray(data.message.content)
      ? data.message.content
      : null

    // Synthetic messages (injected by CLI, e.g. hook output)
    if (data.isSynthetic && contentBlocks) {
      const entries: NormalizedLogEntry[] = []
      for (const item of contentBlocks) {
        if (item.type === 'text' && item.text) {
          entries.push({
            entryType: 'system-message',
            content: item.text,
            timestamp: data.timestamp,
          })
        }
      }
      return entries.length > 0 ? entries : null
    }

    // Tool results embedded in user messages
    const toolResults = (contentBlocks ?? []).filter(
      (block): block is Extract<ClaudeContentItem, { type: 'tool_result' }> =>
        block.type === 'tool_result',
    )

    if (toolResults.length > 0) {
      const kept: NormalizedLogEntry[] = []

      for (const tr of toolResults) {
        const toolUseId = tr.tool_use_id ?? ''

        if (toolUseId && this.filteredToolCallIds.has(toolUseId)) {
          this.filteredToolCallIds.delete(toolUseId)
          continue
        }

        const info = toolUseId ? this.toolMap.get(toolUseId) : undefined
        const resultContent = normalizeToolResultContent(tr.content)

        kept.push({
          entryType: tr.is_error ? 'error-message' : 'tool-use',
          content: resultContent,
          timestamp: data.timestamp,
          metadata: {
            toolCallId: toolUseId,
            toolName: info?.toolName,
            isResult: true,
          },
          toolDetail: info
            ? {
                kind: classifyToolKind(info.toolName),
                toolName: info.toolName,
                toolCallId: toolUseId,
                isResult: true,
                raw: buildToolResultRaw(info, resultContent, tr.is_error),
              }
            : undefined,
        })
      }

      if (kept.length === 0) return null
      return kept
    }

    // Slash command output — only treat content wrapped in <local-command-stdout>
    const rawContent =
      typeof data.message.content === 'string' ? data.message.content : null
    if (rawContent) {
      if (rawContent.includes('<local-command-stdout>')) {
        const stripped = rawContent
          .replace(/^<local-command-stdout>\s*/, '')
          .replace(/\s*<\/local-command-stdout>\s*$/, '')
          .trim()
        if (stripped) {
          return {
            entryType: 'system-message',
            content: stripped,
            timestamp: data.timestamp,
            metadata: { subtype: 'command_output' },
          }
        }
      }
      // Non-command user message echoes → discard
      return null
    }

    return null
  }

  // ---------- Standalone tool_use / tool_result ----------

  private parseToolUse(data: ClaudeToolUse): NormalizedLogEntry | null {
    if (!data.name) return null

    if (this.isFiltered(data.name)) {
      if (data.id) this.filteredToolCallIds.add(data.id)
      return null
    }

    const input = data.input ?? {}
    const toolCallId = data.id ?? ''

    if (toolCallId) {
      this.toolMap.set(toolCallId, { toolName: data.name, input, toolCallId })
    }

    return {
      entryType: 'tool-use',
      content: generateToolContent(data.name, input),
      timestamp: data.timestamp,
      metadata: { toolName: data.name, input, toolCallId },
      toolAction: classifyToolAction(data.name, input),
      toolDetail: {
        kind: classifyToolKind(data.name),
        toolName: data.name,
        toolCallId,
        isResult: false,
        raw: input,
      },
    }
  }

  private parseToolResult(data: ClaudeToolResult): NormalizedLogEntry | null {
    const toolUseId = data.tool_use_id ?? ''

    if (toolUseId && this.filteredToolCallIds.has(toolUseId)) {
      this.filteredToolCallIds.delete(toolUseId)
      return null
    }

    const info = toolUseId ? this.toolMap.get(toolUseId) : undefined
    const resultContent = normalizeToolResultContent(data.content)

    return {
      entryType: data.is_error ? 'error-message' : 'tool-use',
      content: resultContent,
      timestamp: data.timestamp,
      metadata: {
        toolCallId: toolUseId,
        toolName: info?.toolName,
        isResult: true,
      },
      toolDetail: info
        ? {
            kind: classifyToolKind(info.toolName),
            toolName: info.toolName,
            toolCallId: toolUseId,
            isResult: true,
            raw: buildToolResultRaw(info, resultContent, data.is_error),
          }
        : undefined,
    }
  }

  // ---------- Streaming events ----------

  private parseStreamEvent(
    data: ClaudeStreamEvent,
  ): NormalizedLogEntry | null {
    switch (data.type) {
      case 'content_block_delta':
        return this.parseContentBlockDelta(data)
      case 'message_start':
        return this.parseMessageStart(data)
      case 'message_delta':
        return this.parseMessageDelta(data)
      // content_block_start, content_block_stop, message_stop — no user-facing output
      default:
        return null
    }
  }

  private parseContentBlockDelta(
    data: ClaudeStreamEvent,
  ): NormalizedLogEntry | null {
    if (data.delta?.type === 'text_delta' && data.delta.text) {
      return {
        entryType: 'assistant-message',
        content: data.delta.text,
        timestamp: data.timestamp,
        metadata: { streaming: true },
      }
    }
    if (data.delta?.type === 'thinking_delta' && data.delta.thinking) {
      return {
        entryType: 'thinking',
        content: data.delta.thinking,
        timestamp: data.timestamp,
        metadata: { streaming: true },
      }
    }
    return null
  }

  private parseMessageStart(
    data: ClaudeStreamEvent,
  ): NormalizedLogEntry | null {
    if (data.message?.model && !this.modelName) {
      this.modelName = data.message.model
      return {
        entryType: 'system-message',
        content: `System initialized with model: ${data.message.model}`,
        timestamp: data.timestamp,
      }
    }
    return null
  }

  private parseMessageDelta(
    data: ClaudeStreamEvent,
  ): NormalizedLogEntry | null {
    // Emit token usage from message_delta if not from subagent
    if (!data.parent_tool_use_id && data.usage) {
      const input =
        (data.usage.input_tokens ?? 0) +
        (data.usage.cache_creation_input_tokens ?? 0) +
        (data.usage.cache_read_input_tokens ?? 0)
      const output = data.usage.output_tokens ?? 0
      if (input > 0 || output > 0) {
        return {
          entryType: 'token-usage',
          content: `${input} input · ${output} output`,
          timestamp: data.timestamp,
          metadata: { inputTokens: input, outputTokens: output },
        }
      }
    }
    return null
  }

  // ---------- Result ----------

  private parseResult(data: ClaudeResult): NormalizedLogEntry | NormalizedLogEntry[] {
    const entries: NormalizedLogEntry[] = []
    const isLogicalError = !!data.is_error || data.subtype !== 'success'

    const parts: string[] = []
    if (data.duration_ms) parts.push(`${(data.duration_ms / 1000).toFixed(1)}s`)
    if (data.input_tokens) parts.push(`${data.input_tokens} input`)
    if (data.output_tokens) parts.push(`${data.output_tokens} output`)
    if (data.cost_usd) parts.push(`$${data.cost_usd.toFixed(4)}`)

    let errorSummary: string | undefined
    let errorKind: string | undefined
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0]
      const rawError = typeof first === 'string' ? first : JSON.stringify(first)
      const normalized = normalizeExecutionError(rawError)
      errorSummary = normalized.summary
      errorKind = normalized.kind
    }

    if (isLogicalError) {
      parts.unshift(`Execution ${data.subtype ?? 'error'}`)
      if (errorSummary) parts.push(errorSummary)
    }

    entries.push({
      entryType: isLogicalError ? 'error-message' : 'system-message',
      content: parts.length ? parts.join(' · ') : '',
      timestamp: data.timestamp,
      metadata: {
        source: 'result',
        turnCompleted: true,
        resultSubtype: data.subtype,
        isError: isLogicalError,
        errorKind,
        error: errorSummary,
        sessionId: data.session_id,
        costUsd: data.cost_usd,
        inputTokens: data.input_tokens,
        outputTokens: data.output_tokens,
        duration: data.duration_ms,
        numTurns: data.num_turns,
        modelUsage: data.model_usage,
      },
    })

    // If result contains text that wasn't already emitted as assistant message,
    // emit it (same logic as vibe-kanban reference)
    if (
      data.subtype === 'success' &&
      typeof data.result === 'string' &&
      data.result.trim() &&
      (!this.lastAssistantMessage ||
        !this.lastAssistantMessage.includes(data.result))
    ) {
      entries.push({
        entryType: 'assistant-message',
        content: data.result,
        timestamp: data.timestamp,
        metadata: { source: 'result' },
      })
    }

    return entries
  }

  // ---------- Error ----------

  private parseError(data: ClaudeError): NormalizedLogEntry {
    return {
      entryType: 'error-message',
      content: data.error?.message ?? data.message ?? 'Unknown error',
      timestamp: data.timestamp,
      metadata: { errorType: data.error?.type },
    }
  }

  // ---------- Rate limit ----------

  private parseRateLimit(data: ClaudeRateLimit): NormalizedLogEntry {
    return {
      entryType: 'system-message',
      content: 'Rate limit reached',
      timestamp: data.timestamp,
      metadata: {
        subtype: 'rate_limit',
        rateLimitInfo: data.rate_limit_info,
      },
    }
  }

  // ---------- Unknown ----------

  private parseUnknown(data: Record<string, unknown>): NormalizedLogEntry | null {
    const fallbackContent = (data.message ?? data.content ?? '') as string
    const fallbackStr =
      typeof fallbackContent === 'string'
        ? fallbackContent
        : JSON.stringify(fallbackContent)
    if (!fallbackStr.trim()) return null
    return {
      entryType: 'system-message',
      content: fallbackStr,
      timestamp: data.timestamp as string | undefined,
      metadata: { subtype: (data.type as string) ?? 'unknown' },
    }
  }

  // ---------- Helpers ----------

  private isFiltered(toolName: string): boolean {
    return this.rules.some(
      (r) => r.type === 'tool-name' && r.match === toolName,
    )
  }
}

// ---------- Module-level helpers ----------

function normalizeExecutionError(raw: string): {
  kind?: string
  summary: string
} {
  const lower = raw.toLowerCase()
  if (
    lower.includes('lsp server plugin:rust-analyzer-lsp') &&
    lower.includes('crashed')
  ) {
    return {
      kind: 'rust_analyzer_crash',
      summary:
        'Rust analyzer LSP crashed during execution. Retry the task or disable Rust tooling.',
    }
  }
  const compact = raw.replace(/\s+/g, ' ').trim()
  return {
    summary: compact.length > 300 ? `${compact.slice(0, 300)}...` : compact,
  }
}

/** Extract concatenated text from content blocks. */
export function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
    return texts.length > 0 ? texts.join('') : null
  }
  return null
}

/** Generate concise, human-readable content for a tool invocation. */
function generateToolContent(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'Read':
      return String(input.file_path ?? input.path ?? toolName)
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return String(input.file_path ?? input.path ?? toolName)
    case 'Bash':
      return String(input.command ?? input.cmd ?? toolName)
    case 'Grep':
      return input.path
        ? `${input.pattern} in ${input.path}`
        : String(input.pattern ?? toolName)
    case 'Glob':
      return input.path
        ? `${input.pattern ?? input.filePattern} in ${input.path}`
        : String(input.pattern ?? input.filePattern ?? toolName)
    case 'LS':
      return String(input.path ?? toolName)
    case 'WebFetch':
      return String(input.url ?? toolName)
    case 'WebSearch':
      return String(input.query ?? toolName)
    case 'Task':
      return input.description
        ? `Task: ${input.description}`
        : 'Task'
    case 'TodoWrite':
      return 'TODO list updated'
    case 'ExitPlanMode':
      return String(input.plan ?? 'Plan submitted')
    case 'NotebookEdit':
      return String(input.notebook_path ?? toolName)
    default: {
      // MCP tools: mcp__server__tool → mcp:server:tool
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__')
        if (parts.length >= 3) {
          return `mcp:${parts[1]}:${parts[2]}`
        }
      }
      return `Tool: ${toolName}`
    }
  }
}

/** Classify tool kind for ToolDetail.kind field. */
function classifyToolKind(toolName: string): string {
  switch (toolName) {
    case 'Read':
      return 'file-read'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return 'file-edit'
    case 'Bash':
      return 'command-run'
    case 'Grep':
    case 'Glob':
      return 'search'
    case 'WebFetch':
      return 'web-fetch'
    case 'Task':
      return 'task'
    default:
      return 'tool'
  }
}

/** Classify a tool action (for ToolAction discriminated union). */
export function classifyToolAction(
  toolName: string,
  input: Record<string, unknown>,
): ToolAction {
  switch (toolName) {
    case 'Read':
      return {
        kind: 'file-read',
        path: String(input.file_path ?? input.path ?? ''),
      }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return {
        kind: 'file-edit',
        path: String(input.file_path ?? input.path ?? ''),
      }
    case 'Bash':
      return {
        kind: 'command-run',
        command: String(input.command ?? input.cmd ?? ''),
        category: classifyCommand(
          String(input.command ?? input.cmd ?? ''),
        ) as CommandCategory,
      }
    case 'Grep':
    case 'Glob':
      return {
        kind: 'search',
        query: String(input.pattern ?? input.query ?? input.filePattern ?? ''),
      }
    case 'WebFetch':
      return { kind: 'web-fetch', url: String(input.url ?? '') }
    default:
      return { kind: 'tool', toolName, arguments: input }
  }
}

/** Normalize tool_result content to a plain string. */
function normalizeToolResultContent(
  content: string | unknown[] | undefined,
): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part
        if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as { text: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text
        }
        return JSON.stringify(part)
      })
      .join('\n')
  }
  return JSON.stringify(content ?? '')
}

/** Build raw object for tool result persistence. */
function buildToolResultRaw(
  info: ToolCallInfo,
  resultContent: string,
  isError?: boolean,
): Record<string, unknown> {
  return {
    toolName: info.toolName,
    input: info.input,
    result: resultContent,
    isError: isError ?? false,
  }
}
