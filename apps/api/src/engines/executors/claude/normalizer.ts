import type { NormalizedLogEntry, ToolAction } from '@/engines/types'
import type { WriteFilterRule } from '@/engines/write-filter'
import { classifyCommand } from '@/engines/logs'

export class ClaudeLogNormalizer {
  private readonly rules: WriteFilterRule[]
  private readonly filteredToolCallIds = new Set<string>()

  constructor(rules: WriteFilterRule[] = []) {
    this.rules = rules.filter((r) => r.enabled)
  }

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    try {
      const data = JSON.parse(rawLine)

      switch (data.type) {
        case 'assistant':
          return this.parseAssistant(data)
        case 'user':
          return this.parseUser(data)
        case 'content_block_delta':
          return this.parseContentBlockDelta(data)
        case 'tool_use':
          return this.parseToolUse(data)
        case 'tool_result':
          return this.parseToolResult(data)
        case 'error':
          return this.parseError(data)
        case 'system':
          return this.parseSystem(data)
        case 'result':
          return this.parseResult(data)
        default:
          return this.parseDefault(data)
      }
    } catch {
      if (rawLine.trim()) {
        return { entryType: 'system-message', content: rawLine }
      }
      return null
    }
  }

  // --- Private parsers ---

  private parseAssistant(data: any): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const contentBlocks = Array.isArray(data.message?.content) ? data.message.content : null
    const entries: NormalizedLogEntry[] = []

    const text = extractTextContent(contentBlocks ?? data.message?.content)
    if (text) {
      entries.push({
        entryType: 'assistant-message',
        content: text,
        timestamp: data.timestamp,
        metadata: { messageId: data.message?.id },
      })
    }

    const toolBlocks = (contentBlocks ?? []).filter(
      (block: { type?: string }) => block?.type === 'tool_use',
    ) as { id?: string; name?: string; input?: Record<string, unknown> }[]

    for (const toolBlock of toolBlocks) {
      if (!toolBlock.name) continue

      if (this.isFiltered(toolBlock.name)) {
        if (toolBlock.id) this.filteredToolCallIds.add(toolBlock.id)
        continue
      }

      entries.push({
        entryType: 'tool-use',
        content: `Tool: ${toolBlock.name}`,
        timestamp: data.timestamp,
        metadata: {
          messageId: data.message?.id,
          toolName: toolBlock.name,
          input: toolBlock.input,
          toolCallId: toolBlock.id,
        },
        toolAction: classifyToolAction(toolBlock.name, toolBlock.input ?? {}),
      })
    }

    if (entries.length === 0) return null
    return entries
  }

  private parseUser(data: any): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const contentBlocks = Array.isArray(data.message?.content) ? data.message.content : null
    const toolResults = (contentBlocks ?? []).filter(
      (block: { type?: string }) => block?.type === 'tool_result',
    ) as { tool_use_id?: string; content?: string | unknown[]; is_error?: boolean }[]

    if (toolResults.length > 0) {
      const kept: NormalizedLogEntry[] = []

      for (const toolResult of toolResults) {
        if (toolResult.tool_use_id && this.filteredToolCallIds.has(toolResult.tool_use_id)) {
          this.filteredToolCallIds.delete(toolResult.tool_use_id)
          continue
        }

        const resultContent = Array.isArray(toolResult.content)
          ? toolResult.content
              .map((part: unknown) => (typeof part === 'string' ? part : JSON.stringify(part)))
              .join('\n')
          : typeof toolResult.content === 'string'
            ? toolResult.content
            : JSON.stringify(toolResult.content ?? '')

        kept.push({
          entryType: (toolResult.is_error
            ? 'error-message'
            : 'tool-use') as NormalizedLogEntry['entryType'],
          content: resultContent,
          timestamp: data.timestamp,
          metadata: {
            toolCallId: toolResult.tool_use_id,
            isResult: true,
          },
        })
      }

      if (kept.length === 0) return null
      return kept
    }

    // Slash command output
    const rawContent = typeof data.message?.content === 'string' ? data.message.content : null
    if (rawContent) {
      const stripped = rawContent
        .replace(/^<local-command-stdout>\s*/, '')
        .replace(/\s*<\/local-command-stdout>\s*$/, '')
        .trim()
      if (stripped) {
        return {
          entryType: 'system-message' as NormalizedLogEntry['entryType'],
          content: stripped,
          timestamp: data.timestamp,
          metadata: { subtype: 'command_output' },
        }
      }
    }

    return null
  }

  private parseContentBlockDelta(data: any): NormalizedLogEntry | null {
    if (data.delta?.type === 'text_delta') {
      return {
        entryType: 'assistant-message',
        content: data.delta.text ?? '',
        timestamp: data.timestamp,
      }
    }
    return null
  }

  private parseToolUse(data: any): NormalizedLogEntry | null {
    if (this.isFiltered(data.name)) {
      if (data.id) this.filteredToolCallIds.add(data.id)
      return null
    }

    return {
      entryType: 'tool-use',
      content: `Tool: ${data.name}`,
      timestamp: data.timestamp,
      metadata: { toolName: data.name, input: data.input, toolCallId: data.id },
      toolAction: classifyToolAction(data.name, data.input ?? {}),
    }
  }

  private parseToolResult(data: any): NormalizedLogEntry | null {
    if (data.tool_use_id && this.filteredToolCallIds.has(data.tool_use_id)) {
      this.filteredToolCallIds.delete(data.tool_use_id)
      return null
    }

    return {
      entryType: data.is_error ? 'error-message' : 'tool-use',
      content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
      timestamp: data.timestamp,
      metadata: { toolCallId: data.tool_use_id, isResult: true },
    }
  }

  private parseError(data: any): NormalizedLogEntry {
    return {
      entryType: 'error-message',
      content: data.error?.message ?? data.message ?? 'Unknown error',
      timestamp: data.timestamp,
      metadata: { errorType: data.error?.type },
    }
  }

  private parseSystem(data: any): NormalizedLogEntry {
    if (data.subtype === 'init') {
      return {
        entryType: 'system-message',
        content: `Session started (${data.cwd ?? 'unknown dir'})`,
        timestamp: data.timestamp,
        metadata: {
          subtype: data.subtype,
          sessionId: data.session_id,
          cwd: data.cwd,
          slashCommands: Array.isArray(data.slash_commands) ? data.slash_commands : [],
        },
      }
    }
    if (data.subtype === 'compact_boundary') {
      return {
        entryType: 'system-message',
        content: 'Context compacted',
        timestamp: data.timestamp,
        metadata: {
          subtype: data.subtype,
          compactMetadata: data.compact_metadata,
        },
      }
    }
    if (data.subtype === 'hook_response' && data.output) {
      return {
        entryType: 'system-message',
        content: data.output,
        timestamp: data.timestamp,
        metadata: { subtype: data.subtype, hookName: data.hook_name },
      }
    }
    const msg = data.message ?? data.content ?? data.subtype ?? ''
    return {
      entryType: 'system-message',
      content: msg,
      timestamp: data.timestamp,
      metadata: data.subtype ? { subtype: data.subtype } : undefined,
    }
  }

  private parseResult(data: any): NormalizedLogEntry {
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
    return {
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
      },
    }
  }

  private parseDefault(data: any): NormalizedLogEntry | null {
    const fallbackContent = data.message ?? data.content ?? ''
    const fallbackStr =
      typeof fallbackContent === 'string' ? fallbackContent : JSON.stringify(fallbackContent)
    if (!fallbackStr.trim()) return null
    return {
      entryType: 'system-message' as NormalizedLogEntry['entryType'],
      content: fallbackStr,
      timestamp: data.timestamp,
      metadata: { subtype: data.type ?? 'unknown' },
    }
  }

  // --- Private helpers ---

  private isFiltered(toolName: string): boolean {
    return this.rules.some((r) => r.type === 'tool-name' && r.match === toolName)
  }
}

// --- Module-level helpers ---

function normalizeExecutionError(raw: string): { kind?: string; summary: string } {
  const lower = raw.toLowerCase()
  if (lower.includes('lsp server plugin:rust-analyzer-lsp') && lower.includes('crashed')) {
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

export function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('')
  }
  return null
}

export function classifyToolAction(toolName: string, input: Record<string, unknown>): ToolAction {
  switch (toolName) {
    case 'Read':
      return { kind: 'file-read', path: String(input.file_path ?? input.path ?? '') }
    case 'Write':
    case 'Edit':
      return { kind: 'file-edit', path: String(input.file_path ?? input.path ?? '') }
    case 'Bash':
      return {
        kind: 'command-run',
        command: String(input.command ?? ''),
        category: classifyCommand(String(input.command ?? '')),
      }
    case 'Grep':
    case 'Glob':
      return { kind: 'search', query: String(input.pattern ?? input.query ?? '') }
    case 'WebFetch':
      return { kind: 'web-fetch', url: String(input.url ?? '') }
    default:
      return { kind: 'tool', toolName, arguments: input }
  }
}
