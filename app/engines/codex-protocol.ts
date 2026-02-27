import type { FileSink } from 'bun'
import { logger } from '../logger'

const MAX_IO_LOG_CHARS = 1200
const IO_LOG_ENABLED = (process.env.LOG_EXECUTOR_IO ?? '1') !== '0'
const DEFAULT_REQUEST_TIMEOUT = 30_000

function clipForLog(input: string): string {
  if (input.length <= MAX_IO_LOG_CHARS) return input
  return `${input.slice(0, MAX_IO_LOG_CHARS)}...<truncated:${input.length - MAX_IO_LOG_CHARS}>`
}

/** Methods that represent server-side approval requests (has `id`, expects a response). */
const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
])

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface JsonRpcNotification {
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code?: number; message?: string }
}

interface JsonRpcServerRequest {
  id: number | string
  method: string
  params?: Record<string, unknown>
}

/**
 * Determines the category of a parsed JSON-RPC message:
 * - "response": has `id` and (`result` or `error`), no `method`
 * - "server-request": has `id` and `method` (server asking client for something)
 * - "notification": has `method` but no `id`
 * - "unknown": none of the above
 */
function classifyMessage(
  msg: Record<string, unknown>,
): 'response' | 'server-request' | 'notification' | 'unknown' {
  const hasId = 'id' in msg
  const hasMethod = typeof msg.method === 'string'
  const hasResult = 'result' in msg
  const hasError = 'error' in msg

  if (hasId && (hasResult || hasError) && !hasMethod) return 'response'
  if (hasId && hasMethod) return 'server-request'
  if (hasMethod && !hasId) return 'notification'
  return 'unknown'
}

/**
 * Manages the Codex app-server JSON-RPC protocol over stdio (JSONL, no
 * `"jsonrpc":"2.0"`). Uses a push-based approach: a background reader
 * processes ALL stdout lines immediately, routing responses to pending
 * promises, auto-approving server requests, and pushing notifications
 * to a ReadableStream for downstream consumption.
 */
export class CodexProtocolHandler {
  /** Stream of notification lines (JSONL) for downstream normalizeLog consumption. */
  readonly notifications: ReadableStream<Uint8Array>

  private readonly stdin: FileSink
  private readonly pending = new Map<number | string, PendingRequest>()
  private readonly requestTimeout: number
  private notificationController: ReadableStreamDefaultController<Uint8Array> | undefined
  private nextId = 1
  private closed = false
  private _threadId: string | undefined
  private _turnId: string | undefined

  constructor(stdin: FileSink, stdout: ReadableStream<Uint8Array>, requestTimeout = DEFAULT_REQUEST_TIMEOUT) {
    this.stdin = stdin
    this.requestTimeout = requestTimeout

    // Set up notifications TransformStream via ReadableStream with controller
    this.notifications = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.notificationController = controller
      },
    })

    // Start background stdout reader immediately
    this.startBackgroundReader(stdout)
  }

  get threadId(): string | undefined {
    return this._threadId
  }

  get turnId(): string | undefined {
    return this._turnId
  }

  /** Perform the full initialize handshake (call once after process starts). */
  async initialize(): Promise<{ userAgent: string }> {
    const result = (await this.sendRequest('initialize', {
      clientInfo: { name: 'bitk', version: '0.1.0', title: 'BitK' },
      capabilities: {},
    })) as { userAgent?: string }

    this.sendNotification('initialized')

    logger.info({ userAgent: result?.userAgent }, 'codex_protocol_initialized')
    return { userAgent: result?.userAgent ?? 'unknown' }
  }

  /**
   * Create a new thread, returns the thread ID.
   */
  async startThread(options: {
    model?: string
    cwd?: string
    approvalPolicy?: string
    sandbox?: string
  }): Promise<string> {
    const params: Record<string, unknown> = {}
    if (options.model) params.model = options.model
    if (options.cwd) params.cwd = options.cwd
    if (options.approvalPolicy) params.approvalPolicy = options.approvalPolicy
    if (options.sandbox) params.sandbox = options.sandbox

    const result = (await this.sendRequest('thread/start', params)) as {
      thread?: { id?: string }
    }

    const threadId = result?.thread?.id
    if (!threadId) {
      throw new Error('thread/start response missing thread.id')
    }

    this._threadId = threadId
    logger.info({ threadId }, 'codex_protocol_thread_started')
    return threadId
  }

  /**
   * Resume an existing thread.
   */
  async resumeThread(threadId: string): Promise<void> {
    await this.sendRequest('thread/resume', { threadId })
    this._threadId = threadId
    logger.info({ threadId }, 'codex_protocol_thread_resumed')
  }

  /**
   * Start a turn (send user prompt), returns the turn ID.
   */
  async startTurn(threadId: string, prompt: string): Promise<string> {
    const result = (await this.sendRequest('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
    })) as { turn?: { id?: string }; turnId?: string }

    // The response structure may vary — try both shapes
    const turnId = result?.turn?.id ?? result?.turnId
    if (turnId) {
      this._turnId = turnId
    }

    logger.info({ threadId, turnId }, 'codex_protocol_turn_started')
    return turnId ?? ''
  }

  /**
   * Send turn/interrupt to stop the current turn.
   */
  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.sendRequest('turn/interrupt', { threadId, turnId })
    logger.info({ threadId, turnId }, 'codex_protocol_turn_interrupted')
  }

  /**
   * Send a user message for interactive follow-up on an active process.
   * Starts a new turn on the existing thread.
   */
  sendUserMessage(prompt: string): void {
    if (this._threadId) {
      void this.startTurn(this._threadId, prompt)
    }
  }

  /** Close stdin, reject all pending requests, close notification stream. */
  close(): void {
    if (this.closed) return
    this.closed = true

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Connection closed while waiting for response id=${id}`))
    }
    this.pending.clear()

    try {
      this.notificationController?.close()
    } catch {
      /* already closed */
    }

    try {
      this.stdin.end()
    } catch {
      /* already closed */
    }
  }

  /** Start a background reader that processes ALL stdout lines immediately. */
  private startBackgroundReader(stdout: ReadableStream<Uint8Array>): void {
    void (async () => {
      const reader = stdout.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Split on newlines, process each complete line
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            this.processLine(line)
          }
        }
        // Flush remaining buffer
        if (buffer.trim()) this.processLine(buffer)
      } catch (error) {
        logger.warn({ error }, 'codex_protocol_reader_error')
      } finally {
        reader.releaseLock()
        try {
          this.notificationController?.close()
        } catch {
          /* already closed */
        }
      }
    })()
  }

  /** Route a single stdout line to the appropriate handler. */
  private processLine(line: string): void {
    if (IO_LOG_ENABLED) {
      logger.debug({ stream: 'stdout', line: clipForLog(line) }, 'codex_protocol_io')
    }

    const encoder = new TextEncoder()
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      // Non-JSON line — push through as-is
      try {
        this.notificationController?.enqueue(encoder.encode(`${line}\n`))
      } catch {
        /* controller closed */
      }
      return
    }

    const kind = classifyMessage(msg)

    switch (kind) {
      case 'response':
        this.handleResponse(msg as unknown as JsonRpcResponse)
        break

      case 'server-request':
        this.handleServerRequest(msg as unknown as JsonRpcServerRequest)
        break

      case 'notification':
        this.trackNotification(msg as unknown as JsonRpcNotification)
        // Push through for downstream normalizeLog
        try {
          this.notificationController?.enqueue(encoder.encode(`${line}\n`))
        } catch {
          /* controller closed */
        }
        break

      default:
        // Unknown structure — push through
        try {
          this.notificationController?.enqueue(encoder.encode(`${line}\n`))
        } catch {
          /* controller closed */
        }
        break
    }
  }

  /** Send a JSON-RPC request and wait for a matching response. */
  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`JSON-RPC timeout waiting for response to ${method} (id=${id})`))
      }, this.requestTimeout)

      this.pending.set(id, { resolve, reject, timer })
      this.writeJson({ id, method, params })
    })
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const msg: Record<string, unknown> = { method }
    if (params !== undefined) {
      msg.params = params
    }
    this.writeJson(msg)
  }

  /** Match a response to its pending request and resolve/reject. */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) {
      logger.warn({ id: response.id }, 'codex_protocol_orphan_response')
      return
    }

    this.pending.delete(response.id)
    clearTimeout(pending.timer)

    if (response.error) {
      const errMsg = response.error.message ?? 'Unknown JSON-RPC error'
      logger.error(
        { id: response.id, code: response.error.code, message: errMsg },
        'codex_protocol_rpc_error',
      )
      pending.reject(new Error(errMsg))
    } else {
      logger.debug({ id: response.id }, 'codex_protocol_rpc_response')
      pending.resolve(response.result)
    }
  }

  /** Handle server-initiated requests — auto-approves command/file changes. */
  private handleServerRequest(request: JsonRpcServerRequest): void {
    const { id, method } = request

    if (APPROVAL_METHODS.has(method)) {
      logger.debug({ id, method }, 'codex_protocol_auto_approve')
      this.writeJson({ id, result: { decision: 'accept' } })
      return
    }

    logger.warn({ id, method }, 'codex_protocol_unknown_server_request')
    this.writeJson({
      id,
      error: { code: -32601, message: `Unhandled server request: ${method}` },
    })
  }

  /** Track state from known notifications (e.g. turn IDs). */
  private trackNotification(notification: JsonRpcNotification): void {
    const { method, params } = notification

    if (method === 'turn/completed') {
      logger.debug({ turnId: this._turnId }, 'codex_protocol_turn_completed')
      this._turnId = undefined
    }

    // Extract turn ID if provided in turn/started
    if (method === 'turn/started' && params) {
      const turnId = (params as Record<string, unknown>).turnId as string | undefined
      if (turnId) {
        this._turnId = turnId
      }
    }
  }

  /** Serialize data as JSON and write to stdin. */
  private writeJson(data: unknown): void {
    if (this.closed) return
    try {
      const json = JSON.stringify(data)
      if (IO_LOG_ENABLED) {
        logger.debug({ stream: 'stdin', line: clipForLog(json) }, 'codex_protocol_io')
      }
      this.stdin.write(`${json}\n`)
      this.stdin.flush?.()
    } catch (error) {
      logger.warn({ error }, 'codex_protocol_write_failed')
    }
  }
}
