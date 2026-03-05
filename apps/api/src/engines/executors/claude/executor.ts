import { CommandBuilder } from '@/engines/command'
import { safeEnv } from '@/engines/safe-env'
import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  PermissionPolicy,
  SpawnedProcess,
  SpawnOptions,
} from '@/engines/types'
import type { WriteFilterRule } from '@/engines/write-filter'
import { logger } from '@/logger'
import { ClaudeLogNormalizer } from './normalizer'
import { ClaudeProtocolHandler } from './protocol'

// Prefer local `claude` binary; fall back to npx for environments without it.
const BASE_COMMAND = Bun.which('claude') ?? 'npx -y @anthropic-ai/claude-code'

// Known Claude models — Claude Code CLI has no `models` subcommand
// [1m] variants use 1 million context token window
const CLAUDE_MODELS: EngineModel[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', isDefault: false },
  {
    id: 'claude-sonnet-4-6[1m]',
    name: 'Claude Sonnet 4.6 (1M)',
    isDefault: false,
  },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', isDefault: true },
  {
    id: 'claude-opus-4-6[1m]',
    name: 'Claude Opus 4.6 (1M)',
    isDefault: false,
  },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', isDefault: false },
]

export class ClaudeCodeExecutor implements EngineExecutor {
  readonly engineType = 'claude-code' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = [
    'session-fork',
    'context-usage',
    'plan-mode',
  ]

  async spawn(
    options: SpawnOptions,
    env: ExecutionEnv,
  ): Promise<SpawnedProcess> {
    const builder = this.createBaseBuilder(options, env)

    if (options.externalSessionId) {
      builder.param('--session-id', options.externalSessionId)
    }
    if (options.agent) {
      builder.param('--agent', options.agent)
    }

    return this.spawnProcess(builder, options, env, 'spawn')
  }

  async spawnFollowUp(
    options: FollowUpOptions,
    env: ExecutionEnv,
  ): Promise<SpawnedProcess> {
    const builder = this.createBaseBuilder(options, env).param(
      '--resume',
      options.sessionId,
    )

    // Truncate conversation history to a specific message and continue from there
    if (options.resetToMessageId) {
      builder.param('--resume-session-at', options.resetToMessageId)
    }

    return this.spawnProcess(builder, options, env, 'followup')
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    const pid = (spawnedProcess.subprocess as { pid?: number }).pid
    logger.debug({ pid }, 'claude_cancel_requested')

    // Send graceful interrupt via protocol handler.
    // Claude will stop the current operation and emit a Result message.
    // The process stays alive and can accept new user messages.
    if (spawnedProcess.protocolHandler) {
      spawnedProcess.protocolHandler.interrupt()
    } else {
      spawnedProcess.cancel()
    }

    logger.debug({ pid }, 'claude_cancel_interrupt_sent')
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      const resolved = await CommandBuilder.create(BASE_COMMAND)
        .param('--version')
        .env('NPM_CONFIG_LOGLEVEL', 'error')
        .resolve()

      const proc = Bun.spawn([resolved.resolvedPath, ...resolved.args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: safeEnv(resolved.env),
      })

      const timer = setTimeout(() => proc.kill(), 10000)
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (exitCode !== 0) {
        return {
          engineType: 'claude-code',
          installed: false,
          authStatus: 'unknown',
        }
      }

      const stdout = await new Response(proc.stdout).text()
      const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)
      const version = versionMatch?.[1]

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
        binaryPath: resolved.resolvedPath,
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

  private defaultNormalizer = new ClaudeLogNormalizer()

  normalizeLog(
    rawLine: string,
  ): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer(filterRules: WriteFilterRule[]) {
    return new ClaudeLogNormalizer(filterRules)
  }

  /**
   * Discover available slash commands, agents, and plugins by launching
   * Claude Code with `--max-turns 1 -- /` and reading the system init message.
   *
   * This is the same approach as the reference Rust implementation's
   * `discover_available_command_and_plugins`.
   */
  async discoverSlashCommandsAndAgents(
    workingDir: string,
  ): Promise<DiscoveryResult> {
    const resolved = await CommandBuilder.create(BASE_COMMAND)
      .params(['-p', '--verbose', '--output-format=stream-json'])
      .param('--max-turns', '1')
      .params(['--', '/'])
      .env('NPM_CONFIG_LOGLEVEL', 'error')
      .cwd(workingDir)
      .resolve()

    const proc = Bun.spawn([resolved.resolvedPath, ...resolved.args], {
      cwd: resolved.cwd ?? workingDir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      env: safeEnv(resolved.env),
    })

    const result: DiscoveryResult = {
      slashCommands: [],
      agents: [],
      plugins: [],
    }

    // Kill the process after DISCOVERY_TIMEOUT_MS regardless of read state.
    // This prevents orphaned processes when reader.read() hangs (e.g. auth/network).
    const killTimer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already dead */
      }
    }, DISCOVERY_TIMEOUT_MS)

    try {
      const stdout = proc.stdout as ReadableStream<Uint8Array>
      const reader = stdout.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)

          if (!line) continue

          try {
            const data = JSON.parse(line) as {
              type?: string
              subtype?: string
              slash_commands?: string[]
              plugins?: Array<{ name: string; path: string }>
              agents?: string[]
            }
            if (data.type === 'system' && data.subtype === 'init') {
              result.slashCommands = data.slash_commands ?? []
              result.plugins = data.plugins ?? []
              result.agents = data.agents ?? []
              // Got what we need, stop reading
              reader.releaseLock()
              proc.kill()
              return result
            }
          } catch {
            // Not JSON or not the message we want — skip
          }
        }
      }

      reader.releaseLock()
    } finally {
      clearTimeout(killTimer)
      try {
        proc.kill()
      } catch {
        /* already dead */
      }
    }

    return result
  }

  // ---------- Private ----------

  /**
   * Build the common CommandBuilder shared by spawn and spawnFollowUp.
   * Adds all standard flags, model, env vars, and permission-prompt-tool=stdio
   * (permission mode is set via SDK control protocol, not CLI flags).
   */
  private createBaseBuilder(
    options: SpawnOptions,
    env: ExecutionEnv,
  ): CommandBuilder {
    const permissionMode = options.permissionMode ?? 'auto'
    const isPlanMode = permissionMode === 'plan'

    const builder = CommandBuilder.create(BASE_COMMAND)
      .params(['-p', '--output-format=stream-json', '--verbose', '--no-chrome'])
      .param('--input-format', 'stream-json')
      // Enable SDK-based permission handling via stdin/stdout control protocol
      // instead of CLI-level flags like --dangerously-skip-permissions.
      .param('--permission-prompt-tool', 'stdio')
      // Include partial messages for better streaming experience
      .param('--include-partial-messages')
      // Replay user messages during session resume so the model sees full history
      .param('--replay-user-messages')
      .env('NPM_CONFIG_LOGLEVEL', 'error')
      .env('IS_SANDBOX', '1')
      .cwd(options.workingDir)

    // Plan mode: start CLI with bypassPermissions so we can switch back to it
    // after ExitPlanMode. SDK protocol then sets the actual mode to "plan".
    if (isPlanMode) {
      builder.param('--permission-mode', 'bypassPermissions')
    }

    if (options.model && options.model !== 'auto') {
      builder.param('--model', options.model)
    }

    // Disable AskUserQuestion in all modes — the web UI cannot respond
    // to interactive questions. In plan mode, hooks route it to can_use_tool
    // but the auto-allow would leave Claude waiting for an answer that never
    // comes, causing the turn to hang.
    builder.param('--disallowedTools', 'AskUserQuestion')

    if (options.env) {
      builder.envs(options.env)
    }
    if (env.vars) {
      builder.envs(env.vars)
    }

    return builder
  }

  /**
   * Spawn a Bun subprocess, create the protocol handler, perform the SDK
   * init handshake (initialize → set_permission_mode → send_user_message),
   * and return the SpawnedProcess.
   */
  private async spawnProcess(
    builder: CommandBuilder,
    options: SpawnOptions,
    env: ExecutionEnv,
    mode: 'spawn' | 'followup',
  ): Promise<SpawnedProcess> {
    const resolved = await builder.resolve()
    logger.debug(
      {
        issueId: env.issueId,
        cwd: resolved.cwd ?? options.workingDir,
        program: resolved.resolvedPath,
        args: resolved.args,
        ...(mode === 'followup' && 'sessionId' in options
          ? { resumeSessionId: (options as FollowUpOptions).sessionId }
          : {}),
      },
      `claude_${mode}_command`,
    )

    const proc = Bun.spawn([resolved.resolvedPath, ...resolved.args], {
      cwd: resolved.cwd ?? options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv(resolved.env),
    })

    // Create protocol handler to manage bidirectional control protocol
    // (tool permission requests, hook callbacks, graceful interruption)
    const handler = new ClaudeProtocolHandler(proc.stdin)

    // SDK init handshake: initialize → set_permission_mode → user message
    const permissionMode = options.permissionMode ?? 'auto'
    handler.initialize(buildHooks(permissionMode))
    handler.setPermissionMode(permissionMode)
    handler.sendUserMessage(options.prompt)

    logger.debug(
      {
        issueId: env.issueId,
        pid: (proc as { pid?: number }).pid,
        mode,
        promptChars: options.prompt.length,
        permissionMode: options.permissionMode ?? 'auto',
      },
      'claude_process_spawned',
    )

    // Wrap stdout to intercept control_request messages
    const filteredStdout = handler.wrapStdout(
      proc.stdout as ReadableStream<Uint8Array>,
    )

    return {
      subprocess: proc,
      stdout: filteredStdout,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      cancel: () => handler.interrupt(),
      protocolHandler: handler,
      spawnCommand: [resolved.resolvedPath, ...resolved.args].join(' '),
    }
  }
}

// ---------- Types ----------

export interface DiscoveryResult {
  slashCommands: string[]
  agents: string[]
  plugins: Array<{ name: string; path: string }>
}

// ---------- Constants ----------

const DISCOVERY_TIMEOUT_MS = 120_000

// ---------- Helpers ----------

const AUTO_APPROVE_CALLBACK_ID = 'AUTO_APPROVE_CALLBACK_ID'

/**
 * Build hooks configuration based on permission mode.
 *
 * - **plan**: ExitPlanMode → `tool_approval` callback (routed to can_use_tool
 *   for mode-switch handling); everything else → auto-approve.
 *   AskUserQuestion is disabled via --disallowedTools, not hooks.
 * - **supervised**: Non-read tools → `tool_approval`; read tools auto-approved.
 * - **auto**: No hooks needed (AskUserQuestion disabled via --disallowedTools).
 */
function buildHooks(
  policy: PermissionPolicy,
): Record<string, unknown> | undefined {
  switch (policy) {
    case 'plan':
      return {
        PreToolUse: [
          {
            matcher: '^ExitPlanMode$',
            hookCallbackIds: ['tool_approval'],
          },
          {
            matcher: '^(?!ExitPlanMode$).*',
            hookCallbackIds: [AUTO_APPROVE_CALLBACK_ID],
          },
        ],
      }
    case 'supervised':
      return {
        PreToolUse: [
          {
            matcher: '^(?!(Glob|Grep|NotebookRead|Read|Task|TodoWrite)$).*',
            hookCallbackIds: ['tool_approval'],
          },
        ],
      }
    default:
      return undefined
  }
}
