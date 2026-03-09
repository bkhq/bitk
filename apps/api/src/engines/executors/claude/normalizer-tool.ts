import { classifyCommand } from '@/engines/logs'
import type { CommandCategory, ToolAction } from '@/engines/types'
import type { ToolCallInfo } from './normalizer-types'

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
export function generateToolContent(toolName: string, input: Record<string, unknown>): string {
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
      return input.path ? `${input.pattern} in ${input.path}` : String(input.pattern ?? toolName)
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
      return input.description ? `Task: ${input.description}` : 'Task'
    case 'Agent':
      return input.description ? `Agent: ${input.description}` : String(input.prompt ?? 'Agent')
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
export function classifyToolKind(toolName: string): string {
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
export function classifyToolAction(toolName: string, input: Record<string, unknown>): ToolAction {
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
        category: classifyCommand(String(input.command ?? input.cmd ?? '')) as CommandCategory,
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
export function normalizeToolResultContent(content: string | unknown[] | undefined): string {
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
export function buildToolResultRaw(
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

export function normalizeExecutionError(raw: string): {
  kind?: string
  summary: string
} {
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
