// ---------- Claude JSON types (discriminated union) ----------

/** Top-level message envelope from Claude CLI stdout (stream-json format). */
export type ClaudeJson =
  | ClaudeSystem |
  ClaudeAssistant |
  ClaudeUser |
  ClaudeToolUse |
  ClaudeToolResult |
  ClaudeStreamEvent |
  ClaudeStreamEventWrapper |
  ClaudeResult |
  ClaudeError |
  ClaudeRateLimit

export interface ClaudeSystem {
  type: 'system'
  subtype?: string
  session_id?: string
  cwd?: string
  model?: string
  tools?: unknown[]
  apiKeySource?: string
  status?: string
  slash_commands?: string[]
  plugins?: Array<{ name: string, path: string }>
  agents?: string[]
  compact_metadata?: Record<string, unknown>
  output?: string
  hook_name?: string
  message?: string
  content?: string
  timestamp?: string
}

export interface ClaudeAssistant {
  type: 'assistant'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  timestamp?: string
}

export interface ClaudeUser {
  type: 'user'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  isSynthetic?: boolean
  isReplay?: boolean
  timestamp?: string
}

export interface ClaudeToolUse {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
  session_id?: string
  timestamp?: string
}

export interface ClaudeToolResult {
  type: 'tool_result'
  tool_use_id?: string
  content?: string | unknown[]
  is_error?: boolean
  session_id?: string
  timestamp?: string
}

export interface ClaudeStreamEvent {
  type:
    | 'content_block_delta' |
    'content_block_start' |
    'content_block_stop' |
    'message_start' |
    'message_delta' |
    'message_stop'
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

/** Wrapper format: `{"type":"stream_event","event":{...actual event...}}` */
export interface ClaudeStreamEventWrapper {
  type: 'stream_event'
  event: ClaudeStreamEvent
  session_id?: string
  parent_tool_use_id?: string | null
  uuid?: string
  timestamp?: string
}

export interface ClaudeResult {
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

export interface ClaudeError {
  type: 'error'
  error?: { type?: string, message?: string }
  message?: string
  timestamp?: string
}

export interface ClaudeRateLimit {
  type: 'rate_limit'
  session_id?: string
  rate_limit_info?: Record<string, unknown>
  timestamp?: string
}

// ---------- Message / Content types ----------

export interface ClaudeMessage {
  id?: string
  role?: string
  model?: string
  content?: ClaudeContentItem[] | string
  stop_reason?: string
}

export type ClaudeContentItem =
  | { type: 'text', text: string } |
  { type: 'thinking', thinking: string } |
  {
    type: 'tool_use'
    id?: string
    name?: string
    input?: Record<string, unknown>
  } |
  {
    type: 'tool_result'
    tool_use_id?: string
    content?: string | unknown[]
    is_error?: boolean
  }

export interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  service_tier?: string
}

// ---------- Tool call info (for correlating tool_use → tool_result) ----------

export interface ToolCallInfo {
  toolName: string
  input: Record<string, unknown>
  toolCallId: string
}
