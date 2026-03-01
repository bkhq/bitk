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
} from '@/engines/types'
import { classifyCommand } from '@/engines/logs'
import { safeEnv } from '@/engines/safe-env'
import { logger } from '@/logger'
import { CodexProtocolHandler } from './protocol'

const CODEX_CMD = ['npx', '-y', '@openai/codex']
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

  constructor(private proc: ReturnType<typeof Bun.spawn>) {
    this.reader = (
      proc.stdout as ReadableStream<Uint8Array>
    ).getReader() as ReadableStreamDefaultReader<Uint8Array>
  }

  async call(method: string, params: Record<string, unknown>, id: number): Promise<unknown> {
    const request = JSON.stringify({ method, id, params })
    logger.debug({ method, id, request }, 'codex_rpc_send')
    ;(this.proc.stdin as import('bun').FileSink).write(`${request}\n`)

    const deadline = Date.now() + JSONRPC_TIMEOUT

    while (!this.done && Date.now() < deadline) {
      // First, drain any complete lines already in the buffer
      const parsed = this.parseLine(id)
      if (parsed !== undefined) {
        logger.debug({ method, id, result: JSON.stringify(parsed).slice(0, 500) }, 'codex_rpc_recv')
        return parsed
      }

      // Read more data from the stream
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

    // Final attempt to parse remaining buffer
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
    ;(this.proc.stdin as import('bun').FileSink).write(`${msg}\n`)
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
 * @see https://github.com/openai/codex/tree/main/codex-rs/app-server
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
 *
 * Protocol: JSON-RPC lite over stdio (JSONL, no "jsonrpc":"2.0" header).
 * Lifecycle: initialize -> initialized notification -> model/list (paginated) -> kill.
 */
async function queryCodexModels(): Promise<EngineModel[]> {
  logger.debug({ cmd: [...CODEX_CMD, 'app-server'].join(' ') }, 'codex_models_start')

  const proc = Bun.spawn([...CODEX_CMD, 'app-server'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
  })

  // Capture stderr for diagnostics
  const stderrReader = new Response(proc.stderr).text()

  const killTimer = setTimeout(() => {
    logger.warn({ message: 'Killing codex app-server after timeout' }, 'codex_models_kill_timeout')
    proc.kill()
  }, JSONRPC_TIMEOUT + 5000)
  const session = new JsonRpcSession(proc)

  try {
    // 1. Initialize handshake
    logger.debug({ message: 'Sending initialize...' }, 'codex_models_init')
    const initResult = await session.call(
      'initialize',
      { clientInfo: { name: 'bitk', title: 'BitK', version: '0.1.0' } },
      0,
    )
    logger.debug({ result: JSON.stringify(initResult).slice(0, 500) }, 'codex_models_init_done')

    // 2. Send initialized notification (required before other methods)
    session.notify('initialized', {})

    // 3. Paginate through model/list
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

    logger.debug({ count: models.length, models: models.map((m) => m.id) }, 'codex_models_done')
    return models
  } catch (error) {
    const stderr = await stderrReader.catch(() => '')
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stderr: typeof stderr === 'string' ? stderr.slice(0, 1000) : '',
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
 * Extract the command string from a Codex item.
 * Codex sends `item.command` as either a string or string[] depending on version.
 * Also checks `item.commandActions[].command` as fallback.
 */
function extractCommandString(item: Record<string, unknown>): string {
  const cmd = item.command
  if (typeof cmd === 'string') return cmd
  if (Array.isArray(cmd)) {
    return cmd
      .map((a: unknown) => {
        const s = String(a)
        return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
      })
      .join(' ')
  }
  // Fallback: extract from commandActions array
  const actions = item.commandActions as Array<{ command?: unknown }> | undefined
  const rawCmd = actions?.[0]?.command
  if (typeof rawCmd === 'string' && rawCmd) return rawCmd
  return ''
}

/**
 * Codex executor — uses JSON-RPC protocol via `app-server` mode.
 *
 * Launch: `codex app-server`
 * Communication: JSON-RPC over stdio (JSONL)
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
    const cmd = [...CODEX_CMD, 'app-server']

    const proc = Bun.spawn(cmd, {
      cwd: options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
    })

    // Create protocol handler — starts reading stdout immediately
    const handler = new CodexProtocolHandler(proc.stdin, proc.stdout as ReadableStream<Uint8Array>)

    // Perform initialize handshake
    await handler.initialize()

    // Create thread
    await handler.startThread({
      model: options.model,
      cwd: options.workingDir,
      approvalPolicy: 'on-failure',
      sandbox: 'workspace-write',
    })

    // Start turn with user prompt
    await handler.startTurn(handler.threadId!, options.prompt)

    logger.info(
      {
        issueId: env.issueId,
        pid: (proc as { pid?: number }).pid,
        threadId: handler.threadId,
        model: options.model,
      },
      'codex_spawn_complete',
    )

    return {
      subprocess: proc,
      stdout: handler.notifications,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
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
          handler.sendUserMessage(content)
        },
      },
      // Expose the real Codex thread ID so the issue engine stores it
      // instead of the pre-generated UUID (needed for follow-up/resume).
      externalSessionId: handler.threadId,
    }
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const cmd = [...CODEX_CMD, 'app-server']

    const proc = Bun.spawn(cmd, {
      cwd: options.workingDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }),
    })

    const handler = new CodexProtocolHandler(proc.stdin, proc.stdout as ReadableStream<Uint8Array>)

    await handler.initialize()

    // Resume the existing thread (options.sessionId contains the Codex thread ID)
    await handler.resumeThread(options.sessionId)

    // Start a new turn with the follow-up prompt
    await handler.startTurn(handler.threadId!, options.prompt)

    logger.info(
      {
        issueId: env.issueId,
        pid: (proc as { pid?: number }).pid,
        threadId: handler.threadId,
        model: options.model,
      },
      'codex_followup_complete',
    )

    return {
      subprocess: proc,
      stdout: handler.notifications,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
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
          handler.sendUserMessage(content)
        },
      },
      externalSessionId: handler.threadId,
    }
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug(
      { pid: (spawnedProcess.subprocess as { pid?: number }).pid },
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
        { pid: (spawnedProcess.subprocess as { pid?: number }).pid },
        'codex_cancel_completed',
      )
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      const proc = Bun.spawn([...CODEX_CMD, '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const timer = setTimeout(() => proc.kill(), 10000)
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (exitCode !== 0) {
        return { engineType: 'codex', installed: false, authStatus: 'unknown' }
      }

      const stdout = await new Response(proc.stdout).text()
      const versionMatch = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)
      const version = versionMatch?.[1]

      // Check auth — OPENAI_API_KEY, CODEX_API_KEY, or ~/.codex/config.toml
      let authStatus: EngineAvailability['authStatus'] = 'unknown'
      if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
        authStatus = 'authenticated'
      } else {
        const home = process.env.HOME ?? '/root'
        const configFile = Bun.file(`${home}/.codex/config.toml`)
        if (await configFile.exists()) {
          authStatus = 'authenticated'
        } else {
          authStatus = 'unauthenticated'
        }
      }

      return {
        engineType: 'codex',
        installed: true,
        version,
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

  normalizeLog(rawLine: string): NormalizedLogEntry | null {
    const now = new Date().toISOString()

    try {
      const data = JSON.parse(rawLine) as {
        method?: string
        params?: Record<string, unknown>
      }

      const method = data.method
      const params = (data.params ?? {}) as Record<string, unknown>

      // No method field — not a notification we handle
      if (!method) return null

      switch (method) {
        // ------------------------------------------------------------------
        // 1. Streaming assistant text delta
        // ------------------------------------------------------------------
        case 'item/agentMessage/delta': {
          const delta = params.delta as string | undefined
          if (!delta) return null
          return {
            entryType: 'assistant-message',
            content: delta,
            timestamp: now,
            metadata: { streaming: true },
          }
        }

        // ------------------------------------------------------------------
        // 2. Item started — dispatch on item type
        // ------------------------------------------------------------------
        case 'item/started': {
          const item = (params.item ?? {}) as Record<string, unknown>
          const itemType = item.type as string | undefined

          if (itemType === 'commandExecution') {
            const commandStr = extractCommandString(item)
            const toolAction: ToolAction = {
              kind: 'command-run',
              command: commandStr,
              category: commandStr ? classifyCommand(commandStr) : 'other',
            }
            // item/started is a live indicator only — mark streaming so it's
            // emitted via SSE but NOT persisted. item/completed is the canonical record.
            return {
              entryType: 'tool-use',
              content: `Tool: Bash`,
              timestamp: now,
              metadata: {
                streaming: true,
                toolName: 'Bash',
                toolCallId: item.id as string | undefined,
                input: commandStr ? { command: commandStr } : undefined,
              },
              toolAction,
            }
          }

          if (itemType === 'fileChange') {
            const path = item.path as string | undefined
            const toolAction: ToolAction = {
              kind: 'file-edit',
              path: path ?? '',
            }
            // item/started is a live indicator only — see commandExecution above.
            return {
              entryType: 'tool-use',
              content: `Tool: Edit`,
              timestamp: now,
              metadata: {
                streaming: true,
                toolName: 'Edit',
                toolCallId: item.id as string | undefined,
                path,
                input: path ? { file_path: path } : undefined,
              },
              toolAction,
            }
          }

          // item/started for agentMessage is a streaming indicator — the canonical
          // text arrives in item/agentMessage/delta and item/completed.
          if (itemType === 'agentMessage') {
            const text = (item.text as string) ?? ''
            if (!text) return null
            return {
              entryType: 'assistant-message',
              content: text,
              timestamp: now,
              metadata: { streaming: true },
            }
          }

          // reasoning items are skipped (like Claude's thinking blocks)
          if (itemType === 'reasoning') {
            return null
          }

          // Unknown item type — skip
          return null
        }

        // ------------------------------------------------------------------
        // 3. Item completed — dispatch on item type, includes results
        // ------------------------------------------------------------------
        case 'item/completed': {
          const item = (params.item ?? {}) as Record<string, unknown>
          const itemType = item.type as string | undefined

          if (itemType === 'commandExecution') {
            // Codex uses aggregatedOutput instead of stdout/stderr
            const stdout = (item.stdout as string) ?? ''
            const stderr = (item.stderr as string) ?? ''
            const aggregated = (item.aggregatedOutput as string) ?? ''
            const combined = aggregated || [stdout, stderr].filter(Boolean).join('\n')
            const exitCode = item.exitCode as number | undefined
            const duration = (item.durationMs ?? item.duration) as number | undefined
            const commandStr = extractCommandString(item)

            const toolAction: ToolAction = {
              kind: 'command-run',
              command: commandStr,
              result: combined || undefined,
              category: commandStr ? classifyCommand(commandStr) : 'other',
            }

            return {
              entryType: 'tool-use',
              content: combined,
              timestamp: now,
              metadata: {
                toolName: 'Bash',
                isResult: true,
                toolCallId: item.id as string | undefined,
                exitCode,
                duration,
              },
              toolAction,
            }
          }

          if (itemType === 'fileChange') {
            const patches = item.patches as unknown[] | undefined
            const path = item.path as string | undefined
            const patchCount = patches?.length ?? 0
            const summary = path
              ? `File changed: ${path} (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`
              : `File changed (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`

            const toolAction: ToolAction = {
              kind: 'file-edit',
              path: path ?? '',
            }

            return {
              entryType: 'tool-use',
              content: summary,
              timestamp: now,
              metadata: {
                toolName: 'Edit',
                isResult: true,
                toolCallId: item.id as string | undefined,
                path,
              },
              toolAction,
            }
          }

          if (itemType === 'agentMessage') {
            return {
              entryType: 'assistant-message',
              content: (item.text as string) ?? '',
              timestamp: now,
            }
          }

          // Completed reasoning — skip
          if (itemType === 'reasoning') {
            return null
          }

          return null
        }

        // ------------------------------------------------------------------
        // 4. Command execution streaming output delta
        // ------------------------------------------------------------------
        case 'item/commandExecution/outputDelta': {
          const delta = params.delta as string | undefined
          if (!delta) return null
          return {
            entryType: 'tool-use',
            content: delta,
            timestamp: now,
            metadata: { isResult: true, streaming: true },
          }
        }

        // ------------------------------------------------------------------
        // 5. File change streaming output delta
        // ------------------------------------------------------------------
        case 'item/fileChange/outputDelta': {
          const delta = params.delta as string | undefined
          if (!delta) return null
          return {
            entryType: 'tool-use',
            content: delta,
            timestamp: now,
            metadata: { isResult: true, streaming: true },
          }
        }

        // ------------------------------------------------------------------
        // 6. Turn started
        // ------------------------------------------------------------------
        case 'turn/started': {
          const turn = (params.turn ?? {}) as Record<string, unknown>
          return {
            entryType: 'system-message',
            content: 'Turn started',
            timestamp: now,
            metadata: {
              subtype: 'turn_started',
              turnId: turn.id as string | undefined,
            },
          }
        }

        // ------------------------------------------------------------------
        // 7. Turn completed — emit usage stats
        // ------------------------------------------------------------------
        case 'turn/completed': {
          const turn = (params.turn ?? {}) as Record<string, unknown>
          const usage = (turn.usage ?? {}) as Record<string, unknown>
          const inputTokens = usage.inputTokens as number | undefined
          const outputTokens = usage.outputTokens as number | undefined

          const parts: string[] = []
          if (inputTokens != null) {
            // Format large numbers with k suffix for readability
            parts.push(
              inputTokens >= 1000
                ? `${(inputTokens / 1000).toFixed(1)}k input`
                : `${inputTokens} input`,
            )
          }
          if (outputTokens != null) {
            parts.push(
              outputTokens >= 1000
                ? `${(outputTokens / 1000).toFixed(1)}k output`
                : `${outputTokens} output`,
            )
          }

          return {
            entryType: 'system-message',
            content: parts.length ? parts.join(' \u00B7 ') : 'Turn completed',
            timestamp: now,
            metadata: {
              source: 'result',
              turnCompleted: true,
              turnId: turn.id as string | undefined,
              inputTokens,
              outputTokens,
            },
          }
        }

        // ------------------------------------------------------------------
        // 8. Thread started
        // ------------------------------------------------------------------
        case 'thread/started': {
          const threadId = params.threadId as string | undefined
          return {
            entryType: 'system-message',
            content: 'Thread started',
            timestamp: now,
            metadata: {
              subtype: 'thread_started',
              threadId,
            },
          }
        }

        // ------------------------------------------------------------------
        // 9. Thread status changed — only surface systemError
        // ------------------------------------------------------------------
        case 'thread/status/changed': {
          const status = params.status as string | undefined
          if (status === 'systemError') {
            return {
              entryType: 'error-message',
              content: `Thread error: ${(params.message as string) ?? 'system error'}`,
              timestamp: now,
              metadata: { status },
            }
          }
          // Non-error status changes are noisy — skip
          return null
        }

        // ------------------------------------------------------------------
        // 10. Error notification
        // ------------------------------------------------------------------
        case 'error': {
          const error = (params.error ?? {}) as Record<string, unknown>
          const willRetry = params.willRetry as boolean | undefined
          return {
            entryType: 'error-message',
            content: (error.message as string) ?? 'Unknown error',
            timestamp: now,
            metadata: {
              code: error.code as number | undefined,
              willRetry,
            },
          }
        }

        // ------------------------------------------------------------------
        // 11. Reasoning deltas — skip (internal model reasoning)
        // ------------------------------------------------------------------
        case 'item/reasoning/textDelta':
        case 'item/reasoning/summaryTextDelta':
          return null

        // ------------------------------------------------------------------
        // Unknown notification method — skip
        // ------------------------------------------------------------------
        default:
          return null
      }
    } catch {
      // Not valid JSON — treat non-empty lines as plain text system messages
      if (rawLine.trim()) {
        return {
          entryType: 'system-message',
          content: rawLine,
          timestamp: now,
        }
      }
      return null
    }
  }
}
