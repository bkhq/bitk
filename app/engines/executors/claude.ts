import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  SpawnedProcess,
  SpawnOptions,
  ToolAction,
} from '../types'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../logger'
import { ClaudeProtocolHandler } from '../claude-protocol'
import { CommandBuilder } from '../command'
import { classifyCommand } from '../logs'
import { safeEnv } from '../safe-env'

function findClaude(): string | null {
  const fromPath = Bun.which('claude')
  if (fromPath) return fromPath
  // Common install locations not always in PATH
  const home = process.env.HOME ?? ''
  const candidates = [
    join(home, '.local/bin/claude'),
    join(home, '.bun/bin/claude'),
    '/usr/local/bin/claude',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

const CLAUDE_BINARY = findClaude()
const BASE_COMMAND = CLAUDE_BINARY ?? 'npx -y @anthropic-ai/claude-code'

// Known Claude models — Claude Code CLI has no `models` subcommand
// [1m] variants use 1 million context token window
const CLAUDE_MODELS: EngineModel[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', isDefault: false },
  { id: 'claude-sonnet-4-6[1m]', name: 'Claude Sonnet 4.6 (1M)', isDefault: false },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', isDefault: true },
  { id: 'claude-opus-4-6[1m]', name: 'Claude Opus 4.6 (1M)', isDefault: false },
]

function applyPermissionArgs(
  builder: CommandBuilder,
  options: Pick<SpawnOptions, 'permissionMode' | 'model'>,
) {
  if (options.permissionMode === 'auto') {
    // Default to skip-permissions since AskUserQuestion is disabled —
    // plan mode would stall waiting for user approval that never comes.
    builder.param('--dangerously-skip-permissions')
    return
  }

  if (options.permissionMode === 'plan') {
    builder.param('--permission-mode', 'plan')
  }
}

export class ClaudeCodeExecutor implements EngineExecutor {
  readonly engineType = 'claude-code' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = ['session-fork', 'context-usage', 'plan-mode']

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const builder = CommandBuilder.create(BASE_COMMAND)
      .params(['-p', '--output-format=stream-json', '--verbose', '--no-chrome'])
      .param('--input-format', 'stream-json')
      .env('NPM_CONFIG_LOGLEVEL', 'error')
      .env('IS_SANDBOX', '1')
      .cwd(options.workingDir)

    if (options.externalSessionId) {
      builder.param('--session-id', options.externalSessionId)
    }

    if (options.model) {
      builder.param('--model', options.model)
    }

    applyPermissionArgs(builder, options)

    if (options.agent) {
      builder.param('--agent', options.agent)
    }

    // Disable interactive questions — the web UI cannot respond to AskUserQuestion
    builder.param('--disallowedTools', 'AskUserQuestion')

    // Apply environment variables
    if (options.env) {
      builder.envs(options.env)
    }
    if (env.vars) {
      builder.envs(env.vars)
    }

    const cmd = builder.build()
    logger.debug(
      {
        issueId: env.issueId,
        cwd: cmd.cwd ?? options.workingDir,
        program: cmd.program,
        args: cmd.args,
      },
      'claude_spawn_command',
    )

    const proc = Bun.spawn([cmd.program, ...cmd.args], {
      cwd: cmd.cwd ?? options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv(cmd.env),
    })

    // Create protocol handler to manage bidirectional control protocol
    // (tool permission requests, hook callbacks, graceful interruption)
    const handler = new ClaudeProtocolHandler(proc.stdin)
    handler.sendUserMessage(options.prompt)
    logger.debug(
      {
        issueId: env.issueId,
        pid: (proc as { pid?: number }).pid,
        mode: 'spawn',
        promptChars: options.prompt.length,
      },
      'claude_process_spawned',
    )

    // Wrap stdout to intercept control_request messages
    const filteredStdout = handler.wrapStdout(proc.stdout as ReadableStream<Uint8Array>)

    return {
      subprocess: proc,
      stdout: filteredStdout,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      cancel: () => handler.interrupt(),
      protocolHandler: handler,
    }
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const builder = CommandBuilder.create(BASE_COMMAND)
      .params(['-p', '--output-format=stream-json', '--verbose', '--no-chrome'])
      .param('--input-format', 'stream-json')
      .param('--resume', options.sessionId)
      .env('NPM_CONFIG_LOGLEVEL', 'error')
      .env('IS_SANDBOX', '1')
      .cwd(options.workingDir)

    if (options.resetToMessageId) {
      builder.param('--resume-session-at', options.resetToMessageId)
    }

    if (options.model) {
      builder.param('--model', options.model)
    }

    applyPermissionArgs(builder, options)

    // Disable interactive questions for follow-up turns too.
    builder.param('--disallowedTools', 'AskUserQuestion')

    if (options.env) {
      builder.envs(options.env)
    }
    if (env.vars) {
      builder.envs(env.vars)
    }

    const cmd = builder.build()
    logger.debug(
      {
        issueId: env.issueId,
        cwd: cmd.cwd ?? options.workingDir,
        program: cmd.program,
        args: cmd.args,
        resumeSessionId: options.sessionId,
      },
      'claude_followup_command',
    )

    const proc = Bun.spawn([cmd.program, ...cmd.args], {
      cwd: cmd.cwd ?? options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv(cmd.env),
    })

    // Create protocol handler for follow-up session
    const handler = new ClaudeProtocolHandler(proc.stdin)
    handler.sendUserMessage(options.prompt)
    logger.debug(
      {
        issueId: env.issueId,
        pid: (proc as { pid?: number }).pid,
        mode: 'followup',
        promptChars: options.prompt.length,
      },
      'claude_process_spawned',
    )

    const filteredStdout = handler.wrapStdout(proc.stdout as ReadableStream<Uint8Array>)

    return {
      subprocess: proc,
      stdout: filteredStdout,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      cancel: () => handler.interrupt(),
      protocolHandler: handler,
    }
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug(
      { pid: (spawnedProcess.subprocess as { pid?: number }).pid },
      'claude_cancel_requested',
    )
    // Send graceful interrupt via protocol handler first
    if (spawnedProcess.protocolHandler) {
      await spawnedProcess.protocolHandler.interrupt()
    } else {
      spawnedProcess.cancel()
    }

    // Wait for process to exit, with 5s timeout before SIGKILL
    const timeout = setTimeout(() => {
      try {
        spawnedProcess.subprocess.kill(9)
      } catch {
        /* already dead */
      }
    }, 5000)

    try {
      await spawnedProcess.subprocess.exited
    } finally {
      clearTimeout(timeout)
      spawnedProcess.protocolHandler?.close()
      logger.debug(
        { pid: (spawnedProcess.subprocess as { pid?: number }).pid },
        'claude_cancel_completed',
      )
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      let exitCode = -1
      let stdout = ''

      if (CLAUDE_BINARY) {
        const proc = Bun.spawn([CLAUDE_BINARY, '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        exitCode = await proc.exited
        if (exitCode === 0) {
          stdout = await new Response(proc.stdout).text()
        }
      }

      if (exitCode !== 0) {
        // Fall back to npx
        const proc = Bun.spawn(['npx', '-y', '@anthropic-ai/claude-code@latest', '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
          env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
        })

        const timer = setTimeout(() => proc.kill(), 10000)
        exitCode = await proc.exited
        clearTimeout(timer)

        if (exitCode === 0) {
          stdout = await new Response(proc.stdout).text()
        }
      }

      if (exitCode !== 0) {
        return { engineType: 'claude-code', installed: false, authStatus: 'unknown' }
      }

      const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)
      const version = versionMatch?.[1]
      const binaryPath = CLAUDE_BINARY ?? undefined

      // Check auth - look for ANTHROPIC_API_KEY or ~/.claude.json
      let authStatus: EngineAvailability['authStatus'] = 'unknown'
      if (process.env.ANTHROPIC_API_KEY) {
        authStatus = 'authenticated'
      } else {
        const home = process.env.HOME ?? '/root'
        const configFile = Bun.file(`${home}/.claude.json`)
        if (await configFile.exists()) {
          authStatus = 'authenticated'
        } else {
          authStatus = 'unauthenticated'
        }
      }

      return {
        engineType: 'claude-code',
        installed: true,
        version,
        binaryPath,
        authStatus,
      }
    } catch (error) {
      return {
        engineType: 'claude-code',
        installed: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    // Claude Code CLI has no `models` subcommand.
    // Return known models statically.
    return CLAUDE_MODELS
  }

  normalizeLog(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    try {
      const data = JSON.parse(rawLine)

      // Handle different Claude Code stream-json message types
      switch (data.type) {
        case 'assistant': {
          const contentBlocks = Array.isArray(data.message?.content) ? data.message.content : null
          const entries: NormalizedLogEntry[] = []

          // Extract text content (if any)
          const text = extractTextContent(contentBlocks ?? data.message?.content)
          if (text) {
            entries.push({
              entryType: 'assistant-message',
              content: text,
              timestamp: data.timestamp,
              metadata: { messageId: data.message?.id },
            })
          }

          // Extract ALL tool_use blocks (not just the first one)
          const toolBlocks = (contentBlocks ?? []).filter(
            (block: { type?: string }) => block?.type === 'tool_use',
          ) as { id?: string; name?: string; input?: Record<string, unknown> }[]
          for (const toolBlock of toolBlocks) {
            if (!toolBlock.name) continue
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

          // Non-text, non-tool_use blocks (e.g. 'thinking') are intentionally ignored
          if (entries.length === 0) return null
          return entries
        }

        case 'user': {
          const contentBlocks = Array.isArray(data.message?.content) ? data.message.content : null
          // Extract ALL tool_result blocks (not just the first one)
          const toolResults = (contentBlocks ?? []).filter(
            (block: { type?: string }) => block?.type === 'tool_result',
          ) as { tool_use_id?: string; content?: string | unknown[]; is_error?: boolean }[]
          if (toolResults.length === 0) return null

          return toolResults.map((toolResult) => {
            const resultContent = Array.isArray(toolResult.content)
              ? toolResult.content
                  .map((part: unknown) => (typeof part === 'string' ? part : JSON.stringify(part)))
                  .join('\n')
              : typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content ?? '')

            return {
              entryType: (toolResult.is_error
                ? 'error-message'
                : 'tool-use') as NormalizedLogEntry['entryType'],
              content: resultContent,
              timestamp: data.timestamp,
              metadata: {
                toolCallId: toolResult.tool_use_id,
                isResult: true,
              },
            }
          })
        }

        case 'content_block_delta': {
          if (data.delta?.type === 'text_delta') {
            return {
              entryType: 'assistant-message',
              content: data.delta.text ?? '',
              timestamp: data.timestamp,
            }
          }
          if (data.delta?.type === 'thinking_delta') {
            return null
          }
          return null
        }

        case 'tool_use': {
          const toolAction = classifyToolAction(data.name, data.input)
          return {
            entryType: 'tool-use',
            content: `Tool: ${data.name}`,
            timestamp: data.timestamp,
            metadata: { toolName: data.name, input: data.input, toolCallId: data.id },
            toolAction,
          }
        }

        case 'tool_result': {
          return {
            entryType: 'tool-use',
            content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
            timestamp: data.timestamp,
            metadata: { toolCallId: data.tool_use_id, isResult: true },
          }
        }

        case 'error': {
          return {
            entryType: 'error-message',
            content: data.error?.message ?? data.message ?? 'Unknown error',
            timestamp: data.timestamp,
            metadata: { errorType: data.error?.type },
          }
        }

        case 'system': {
          // init event: session started
          if (data.subtype === 'init') {
            return {
              entryType: 'system-message',
              content: `Session started (${data.cwd ?? 'unknown dir'})`,
              timestamp: data.timestamp,
              metadata: {
                subtype: data.subtype,
                sessionId: data.session_id,
                cwd: data.cwd,
              },
            }
          }
          // hook_response: output from hooks
          if (data.subtype === 'hook_response' && data.output) {
            return {
              entryType: 'system-message',
              content: data.output,
              timestamp: data.timestamp,
              metadata: { subtype: data.subtype, hookName: data.hook_name },
            }
          }
          // Skip noisy lifecycle events
          if (data.subtype === 'hook_started' || data.subtype === 'hook_completed') {
            return null
          }
          // Other system events: use message/content/subtype
          const msg = data.message ?? data.content ?? data.subtype ?? ''
          if (!msg) return null
          return {
            entryType: 'system-message',
            content: msg,
            timestamp: data.timestamp,
            metadata: data.subtype ? { subtype: data.subtype } : undefined,
          }
        }

        case 'result': {
          // Result is a session completion summary — emit metadata only,
          // don't duplicate the assistant content
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

        default:
          return null
      }
    } catch {
      // Not JSON or parse error - treat as plain text
      if (rawLine.trim()) {
        return {
          entryType: 'system-message',
          content: rawLine,
        }
      }
      return null
    }
  }
}

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

// Helper: extract text content from Claude message content array
function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('')
  }
  return null
}

// Helper: classify tool action
function classifyToolAction(toolName: string, input: Record<string, unknown>): ToolAction {
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
