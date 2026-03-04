import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
  SpawnedProcess,
  SpawnOptions,
} from '@/engines/types'
import type { WriteFilterRule } from '@/engines/write-filter'
import { logger } from '@/logger'
import { ClaudeLogNormalizer } from './normalizer'
import { ClaudeProtocolHandler } from './protocol'

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
    const builder = this.createBaseBuilder(options, env)
      .param('--resume', options.sessionId)
      .param('--replay-user-messages')

    if (options.resetToMessageId) {
      builder.param('--resume-session-at', options.resetToMessageId)
    }

    return this.spawnProcess(builder, options, env, 'followup')
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug(
      { pid: (spawnedProcess.subprocess as { pid?: number }).pid },
      'claude_cancel_requested',
    )
    // Send graceful interrupt via protocol handler (fire-and-forget write to stdin)
    if (spawnedProcess.protocolHandler) {
      spawnedProcess.protocolHandler.interrupt()
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
        const proc = Bun.spawn(
          ['npx', '-y', '@anthropic-ai/claude-code', '--version'],
          {
            stdout: 'pipe',
            stderr: 'pipe',
            env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
          },
        )

        const timer = setTimeout(() => proc.kill(), 10000)
        exitCode = await proc.exited
        clearTimeout(timer)

        if (exitCode === 0) {
          stdout = await new Response(proc.stdout).text()
        }
      }

      if (exitCode !== 0) {
        return {
          engineType: 'claude-code',
          installed: false,
          authStatus: 'unknown',
        }
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

  private defaultNormalizer = new ClaudeLogNormalizer()

  normalizeLog(
    rawLine: string,
  ): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer(filterRules: WriteFilterRule[]) {
    return new ClaudeLogNormalizer(filterRules)
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
    const builder = CommandBuilder.create(BASE_COMMAND)
      .params(['-p', '--output-format=stream-json', '--verbose', '--no-chrome'])
      .param('--input-format', 'stream-json')
      // Enable SDK-based permission handling via stdin/stdout control protocol
      // instead of CLI-level flags like --dangerously-skip-permissions.
      .param('--permission-prompt-tool', 'stdio')
      // Include partial messages for better streaming experience
      .param('--include-partial-messages')
      .env('NPM_CONFIG_LOGLEVEL', 'error')
      .env('IS_SANDBOX', '1')
      .cwd(options.workingDir)

    if (options.model && options.model !== 'auto') {
      builder.param('--model', options.model)
    }

    // Disable interactive questions — the web UI cannot respond to AskUserQuestion
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
  private spawnProcess(
    builder: CommandBuilder,
    options: SpawnOptions,
    env: ExecutionEnv,
    mode: 'spawn' | 'followup',
  ): SpawnedProcess {
    const cmd = builder.build()
    logger.debug(
      {
        issueId: env.issueId,
        cwd: cmd.cwd ?? options.workingDir,
        program: cmd.program,
        args: cmd.args,
        ...(mode === 'followup' && 'sessionId' in options
          ? { resumeSessionId: (options as FollowUpOptions).sessionId }
          : {}),
      },
      `claude_${mode}_command`,
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

    // SDK init handshake: initialize → set_permission_mode → user message
    handler.initialize()
    handler.setPermissionMode(options.permissionMode ?? 'auto')
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
      spawnCommand: [cmd.program, ...cmd.args].join(' '),
    }
  }
}
