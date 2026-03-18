import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { safeEnv } from '@/engines/safe-env'
import type { StdinWriter, Subprocess } from '@/engines/spawn'
import { resolveCommand, runCommand, spawnNode } from '@/engines/spawn'
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

import { logger } from '@/logger'
import { CodexLogNormalizer } from './normalizer'
import type { ThreadStartParams } from './protocol'
import { CodexProtocolHandler } from './protocol'

const NPX_FALLBACK = ['npx', '-y', '@openai/codex']

/**
 * Find the `codex` binary in well-known locations WITHOUT falling back to npx.
 * Used by getAvailability() to determine if the engine is truly installed.
 * Returns null if no binary is found.
 */
function resolveBinaryOnly(): string | null {
  // 1. Check /work/bin first (container / custom deploy)
  if (existsSync('/work/bin/codex')) return '/work/bin/codex'
  // 2. Check PATH
  const fromPath = resolveCommand('codex')
  if (fromPath) return fromPath
  // 3. Check common install locations
  const home = process.env.HOME ?? ''
  const candidates = [
    ...(home ? [join(home, '.local/bin/codex'), join(home, '.bun/bin/codex')] : []),
    '/usr/local/bin/codex',
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

/**
 * Find the `codex` binary, checking PATH and common install locations.
 * Falls back to npx for environments without a standalone binary.
 * Result is cached after first call.
 */
let _cachedBaseCmd: string[] | undefined
function resolveBaseCmd(): string[] {
  if (_cachedBaseCmd) return _cachedBaseCmd
  const binary = resolveBinaryOnly()
  if (binary) {
    _cachedBaseCmd = [binary]
    return _cachedBaseCmd
  }
  // Fall back to npx (for execution only, not availability detection)
  _cachedBaseCmd = NPX_FALLBACK
  return _cachedBaseCmd
}
const JSONRPC_TIMEOUT = 15000

/**
 * Lightweight JSON-RPC session over a stdio process.
 * Shares a single ReadableStream reader and buffer across calls
 * so no data is lost between sequential requests.
 */
class JsonRpcSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private decoder = new TextDecoder()
  private buffer = ''
  private done = false
  private stdin: StdinWriter

  constructor(private proc: Subprocess) {
    this.stdin = proc.stdin
    this.reader = (
      proc.stdout as ReadableStream<Uint8Array>
    ).getReader() as ReadableStreamDefaultReader<Uint8Array>
  }

  async call(method: string, params: Record<string, unknown>, id: number): Promise<unknown> {
    const request = JSON.stringify({ method, id, params })
    logger.debug({ method, id, request }, 'codex_rpc_send')
    this.stdin.write(`${request}\n`)

    const deadline = Date.now() + JSONRPC_TIMEOUT

    while (!this.done && Date.now() < deadline) {
      const parsed = this.parseLine(id)
      if (parsed !== undefined) {
        logger.debug({ method, id, result: JSON.stringify(parsed).slice(0, 500) }, 'codex_rpc_recv')
        return parsed
      }

      const { value, done } = await this.reader.read()
      if (done) {
        logger.debug(
          {
            method,
            id,
            remainingBuffer: this.buffer.slice(0, 500),
          },
          'codex_rpc_stream_end',
        )
        this.done = true
        break
      }
      const chunk = this.decoder.decode(value, { stream: true })
      logger.debug(
        {
          method,
          id,
          chunkLen: chunk.length,
          chunk: chunk.slice(0, 500),
        },
        'codex_rpc_chunk',
      )
      this.buffer += chunk
    }

    const parsed = this.parseLine(id)
    if (parsed !== undefined) {
      logger.debug(
        {
          method,
          id,
          result: JSON.stringify(parsed).slice(0, 500),
        },
        'codex_rpc_recv_final',
      )
      return parsed
    }

    logger.error(
      {
        method,
        id,
        bufferLen: this.buffer.length,
        buffer: this.buffer.slice(0, 1000),
        streamDone: this.done,
      },
      'codex_rpc_timeout',
    )
    throw new Error(`JSON-RPC timeout waiting for response id=${id}`)
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method: string, params: Record<string, unknown>): void {
    const msg = JSON.stringify({ method, params })
    logger.debug({ method }, 'codex_rpc_notify')
    this.stdin.write(`${msg}\n`)
  }

  /** Try to extract and return the response matching `id` from buffered lines. */
  private parseLine(id: number): unknown | undefined {
    for (
      let newlineIdx = this.buffer.indexOf('\n');
      newlineIdx !== -1;
      newlineIdx = this.buffer.indexOf('\n')
    ) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        logger.debug({ line: line.slice(0, 200) }, 'codex_rpc_non_json')
        continue
      }
      logger.debug(
        {
          waitingForId: id,
          msgId: msg.id,
          msgKeys: Object.keys(msg),
          line: line.slice(0, 300),
        },
        'codex_rpc_line',
      )
      if (msg.id === id) {
        if (msg.error) {
          const err = msg.error as { message?: string }
          logger.error({ method: `id=${id}`, error: err.message }, 'codex_rpc_error')
          throw new Error(err.message ?? 'JSON-RPC error')
        }
        return msg.result
      }
    }
    return undefined
  }

  destroy(): void {
    this.reader.releaseLock()
  }
}

/**
 * Codex app-server model/list response shape.
 */
interface CodexModelListResponse {
  data: Array<{
    id: string
    model: string
    displayName: string
    description?: string
    isDefault?: boolean
  }>
  nextCursor?: string | null
}

/**
 * Start a short-lived Codex app-server, perform the initialize handshake,
 * then paginate through model/list. Returns flattened EngineModel[].
 */
async function queryCodexModels(): Promise<EngineModel[]> {
  logger.debug({ cmd: [...resolveBaseCmd(), 'app-server'].join(' ') }, 'codex_models_start')

  const proc = spawnNode([...resolveBaseCmd(), 'app-server'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
    detached: false,
  })

  // Drain stderr to prevent pipe from filling up and blocking the process
  const stderrReader = new Response(proc.stderr).text()

  const killTimer = setTimeout(() => {
    logger.warn({ message: 'Killing codex app-server after timeout' }, 'codex_models_kill_timeout')
    proc.kill()
  }, JSONRPC_TIMEOUT + 5000)
  const session = new JsonRpcSession(proc)

  try {
    logger.debug({ message: 'Sending initialize...' }, 'codex_models_init')
    const initResult = await session.call(
      'initialize',
      {
        clientInfo: { name: 'bkd', title: 'BKD', version: '0.1.0' },
        capabilities: { experimental_api: true },
      },
      0,
    )
    logger.debug({ result: JSON.stringify(initResult).slice(0, 500) }, 'codex_models_init_done')

    session.notify('initialized', {})

    const models: EngineModel[] = []
    let cursor: string | null | undefined = null
    let reqId = 1

    do {
      const params: Record<string, unknown> = {}
      if (cursor) params.cursor = cursor

      logger.debug({ cursor, reqId }, 'codex_models_list')
      const result = (await session.call('model/list', params, reqId++)) as CodexModelListResponse
      logger.debug({ rawResult: JSON.stringify(result).slice(0, 1000) }, 'codex_models_list_done')

      if (result?.data) {
        for (const m of result.data) {
          models.push({
            id: m.id,
            name: m.displayName ?? m.model ?? m.id,
            isDefault: m.isDefault,
          })
        }
      }

      cursor = result?.nextCursor
    } while (cursor)

    logger.debug({ count: models.length, models: models.map(m => m.id) }, 'codex_models_done')
    return models
  } catch (error) {
    const stderr = await stderrReader.catch(() => '')
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stderr: stderr.slice(0, 1000),
      },
      'codex_models_error',
    )
    throw error
  } finally {
    session.destroy()
    clearTimeout(killTimer)
    proc.kill()
  }
}

/**
 * Build the common thread start params used by both spawn and spawnFollowUp.
 */
function buildThreadParams(options: SpawnOptions): ThreadStartParams {
  // Treat 'auto' as unset so Codex uses its own default model
  const model = options.model && options.model !== 'auto' ? options.model : undefined
  const params: ThreadStartParams = {
    model,
    cwd: options.workingDir,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  }
  return params
}

/**
 * Codex executor — uses JSON-RPC protocol via `app-server` mode.
 *
 * Protocol: JSON-RPC over stdio (JSONL), with `codex/event/*` notifications
 * when `experimental_api: true` capability is sent during initialize.
 */
export class CodexExecutor implements EngineExecutor {
  readonly engineType = 'codex' as const
  readonly protocol = 'json-rpc' as const
  readonly capabilities: EngineCapability[] = [
    'session-fork',
    'setup-helper',
    'context-usage',
    'sandbox',
    'reasoning',
  ]

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const cmd = [...resolveBaseCmd(), 'app-server']

    const proc = spawnNode(cmd, {
      cwd: options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error', ...env.vars }),
    })

    // Create protocol handler — starts reading stdout immediately
    const handler = new CodexProtocolHandler(proc.stdin, proc.stdout)

    // Perform initialize handshake
    await handler.initialize()

    // Auth pre-check: detect missing credentials early
    try {
      const account = await handler.getAccount()
      if (account.requiresOpenaiAuth && !account.account) {
        throw new Error(
          'Codex authentication required. Set OPENAI_API_KEY or CODEX_API_KEY, or run `codex auth`.',
        )
      }
    } catch (authErr) {
      // account/read may not be supported on older versions — log and continue
      const msg = authErr instanceof Error ? authErr.message : String(authErr)
      if (msg.includes('authentication required')) throw authErr
      logger.debug({ error: msg }, 'codex_account_read_skipped')
    }

    // Create thread with full params
    const threadParams = buildThreadParams(options)
    const { threadId } = await handler.startThread(threadParams)

    // Start turn with user prompt
    await handler.startTurn(threadId, options.prompt)

    logger.info(
      {
        issueId: env.issueId,
        pid: proc.pid,
        threadId: handler.threadId,
        model: options.model,
      },
      'codex_spawn_complete',
    )

    return {
      subprocess: proc,
      stdout: handler.notifications,
      stderr: proc.stderr,
      cancel: () => {
        if (handler.threadId && handler.turnId) {
          void handler.interrupt(handler.threadId, handler.turnId).catch(() => {})
        }
      },
      protocolHandler: {
        interrupt: async () => {
          if (handler.threadId && handler.turnId) {
            await handler.interrupt(handler.threadId, handler.turnId)
          }
        },
        close: () => handler.close(),
        sendUserMessage: (content: string) => {
          void handler.sendUserMessage(content)
        },
      },
      externalSessionId: handler.threadId,
      spawnCommand: cmd.join(' '),
    }
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const cmd = [...resolveBaseCmd(), 'app-server']

    const proc = spawnNode(cmd, {
      cwd: options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error', ...env.vars }),
    })

    const handler = new CodexProtocolHandler(proc.stdin, proc.stdout)

    await handler.initialize()

    // Resume the existing thread — appends new turns to the same conversation.
    // This keeps the thread ID stable so follow-up chains work correctly.
    await handler.resumeThread(options.sessionId)
    const threadId = options.sessionId

    // Start a new turn with the follow-up prompt
    await handler.startTurn(threadId, options.prompt)

    logger.info(
      {
        issueId: env.issueId,
        pid: proc.pid,
        threadId: handler.threadId,
        resumedFrom: options.sessionId,
        model: options.model,
      },
      'codex_followup_complete',
    )

    return {
      subprocess: proc,
      stdout: handler.notifications,
      stderr: proc.stderr,
      cancel: () => {
        if (handler.threadId && handler.turnId) {
          void handler.interrupt(handler.threadId, handler.turnId).catch(() => {})
        }
      },
      protocolHandler: {
        interrupt: async () => {
          if (handler.threadId && handler.turnId) {
            await handler.interrupt(handler.threadId, handler.turnId)
          }
        },
        close: () => handler.close(),
        sendUserMessage: (content: string) => {
          void handler.sendUserMessage(content)
        },
      },
      externalSessionId: handler.threadId,
      spawnCommand: cmd.join(' '),
    }
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug(
      { pid: spawnedProcess.subprocess.pid },
      'codex_cancel_requested',
    )

    if (spawnedProcess.protocolHandler) {
      await spawnedProcess.protocolHandler.interrupt()
    } else {
      spawnedProcess.cancel()
    }

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
        { pid: spawnedProcess.subprocess.pid },
        'codex_cancel_completed',
      )
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      // Only check real binary paths — do not fall back to npx
      const binaryPath = resolveBinaryOnly()
      if (!binaryPath) {
        return { engineType: 'codex', installed: false, authStatus: 'unknown' }
      }

      const { code: exitCode, stdout } = await runCommand([binaryPath, '--version'], {
        timeout: 10000,
        stderr: 'pipe',
      })

      if (exitCode !== 0) {
        return { engineType: 'codex', installed: false, authStatus: 'unknown' }
      }

      const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)
      const version = versionMatch?.[1]

      // Verify auth via app-server account/read RPC
      const authStatus = await this.verifyAuth(binaryPath)

      return {
        engineType: 'codex',
        installed: true,
        version,
        binaryPath,
        authStatus,
      }
    } catch (error) {
      return {
        engineType: 'codex',
        installed: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Verify authentication by starting a short-lived app-server and calling
   * account/read. This checks if the API key / OAuth session is valid.
   */
  private async verifyAuth(binaryPath: string): Promise<EngineAvailability['authStatus']> {
    const proc = spawnNode([binaryPath, 'app-server'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
      detached: false,
    })

    const killTimer = setTimeout(() => proc.kill(), JSONRPC_TIMEOUT + 5000)
    const session = new JsonRpcSession(proc)

    try {
      await session.call(
        'initialize',
        {
          clientInfo: { name: 'bkd', title: 'BKD', version: '0.1.0' },
          capabilities: { experimental_api: true },
        },
        0,
      )
      session.notify('initialized', {})

      const account = (await session.call('account/read', {}, 1)) as Record<string, unknown>

      // Handle both camelCase and snake_case response shapes
      const requiresAuth = account.requiresOpenaiAuth ?? account.requires_openai_auth
      if (requiresAuth && !account.account) {
        return 'unauthenticated'
      }
      return 'authenticated'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.debug({ error: msg }, 'codex_auth_verify_failed')
      // Only fall back to env/config heuristics if the method is unsupported
      // (i.e. older Codex version). For other errors (auth failure, timeout)
      // report unknown rather than masking the real status.
      if (/method not found|not supported|unknown method/i.test(msg)) {
        if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
          return 'authenticated'
        }
        const home = process.env.HOME ?? '/root'
        if (existsSync(`${home}/.codex/config.toml`)) {
          return 'authenticated'
        }
      }
      return 'unknown'
    } finally {
      session.destroy()
      clearTimeout(killTimer)
      proc.kill()
    }
  }

  async getModels(): Promise<EngineModel[]> {
    try {
      return await queryCodexModels()
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'codex_get_models_failed',
      )
      return []
    }
  }

  /**
   * Create a stateful normalizer that handles `codex/event/*` notifications.
   * This replaces the stateless normalizeLog for proper streaming state tracking.
   */
  createNormalizer() {
    const normalizer = new CodexLogNormalizer()
    return {
      parse: (rawLine: string) => normalizer.parse(rawLine),
    }
  }

  /**
   * Stateless normalizer (legacy fallback).
   * Prefer createNormalizer() which maintains state for streaming events.
   */
  normalizeLog(rawLine: string): NormalizedLogEntry | null {
    const normalizer = new CodexLogNormalizer()
    const result = normalizer.parse(rawLine)
    if (Array.isArray(result)) return result[0] ?? null
    return result
  }
}
