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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CommandBuilder } from '@/engines/command'
import { safeEnv } from '@/engines/safe-env'
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

    if (options.model && options.model !== 'auto') {
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

    if (options.model && options.model !== 'auto') {
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
        const proc = Bun.spawn(['npx', '-y', '@anthropic-ai/claude-code', '--version'], {
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

  private defaultNormalizer = new ClaudeLogNormalizer()

  normalizeLog(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer(filterRules: WriteFilterRule[]) {
    return new ClaudeLogNormalizer(filterRules)
  }
}
