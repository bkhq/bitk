import type { FileSink } from 'bun'
import { ulid } from 'ulid'
import { logger } from '@/logger'

const MAX_IO_LOG_CHARS = 1200
const IO_LOG_ENABLED = (process.env.LOG_EXECUTOR_IO ?? '1') !== '0'

function clipForLog(input: string): string {
  if (input.length <= MAX_IO_LOG_CHARS) return input
  return `${input.slice(0, MAX_IO_LOG_CHARS)}...<truncated:${input.length - MAX_IO_LOG_CHARS}>`
}

/** Fields to keep when sanitizing result messages for logging. */
const RESULT_KEEP_FIELDS = new Set([
  'type',
  'subtype',
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'duration_ms',
  'session_id',
  'is_error',
  'num_turns',
])

/**
 * If the line is a JSON result message, strip verbose fields (e.g.
 * `result.errors`) and keep only the lightweight metadata listed in
 * `RESULT_KEEP_FIELDS`.  Non-result lines are returned unchanged.
 */
function sanitizeResultLine(line: string): string {
  // Fast string check — avoid JSON.parse on the vast majority of lines
  if (!line.includes('"type":"result"')) return line

  try {
    const data = JSON.parse(line)
    if (data?.type !== 'result') return line

    const sanitized: Record<string, unknown> = {}
    for (const key of RESULT_KEEP_FIELDS) {
      if (key in data) {
        sanitized[key] = data[key]
      }
    }

    // Signal that the errors were redacted, not absent
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      sanitized.errors_redacted = data.errors.length
    }

    return JSON.stringify(sanitized)
  } catch {
    return line
  }
}

function shouldSkipStdoutIoLog(line: string): boolean {
  // Filter noisy thinking payloads from API logs.
  if (line.includes('"type":"system"') && line.includes('"hook_name":"SessionStart:startup"')) {
    return true
  }
  return (
    line.includes('"type":"assistant"') &&
    line.includes('"role":"assistant"') &&
    line.includes('"type":"thinking"')
  )
}

interface ControlRequest {
  subtype: string
  tool_name?: string
  input?: unknown
  callback_id?: string
  tool_use_id?: string
}

/**
 * Handles Claude Code's bidirectional control protocol.
 *
 * When --input-format=stream-json is used, Claude Code CLI sends control_request
 * messages on stdout (e.g. can_use_tool, hook_callback) and expects responses
 * on stdin. This class intercepts those messages, auto-approves them, and
 * filters them out of the stdout stream so downstream consumers only see
 * normal log entries.
 */
export class ClaudeProtocolHandler {
  private stdin: FileSink
  private closed = false

  constructor(stdin: FileSink) {
    this.stdin = stdin
  }

  /**
   * Wraps the raw stdout stream, intercepting control_request messages
   * and passing everything else through to the downstream consumer.
   */
  wrapStdout(rawStdout: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = rawStdout.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''

    const isControlReq = this.isControlRequest.bind(this)
    const processControlReq = this.processControlRequest.bind(this)

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          // Process any complete lines already in the buffer
          const newlineIdx = buffer.indexOf('\n')
          if (newlineIdx !== -1) {
            const line = buffer.slice(0, newlineIdx)
            buffer = buffer.slice(newlineIdx + 1)

            if (!line.trim()) continue

            if (IO_LOG_ENABLED && !shouldSkipStdoutIoLog(line)) {
              logger.debug(
                { stream: 'stdout', line: clipForLog(sanitizeResultLine(line)) },
                'claude_protocol_io',
              )
            }

            // Try to parse as control_request
            if (isControlReq(line)) {
              processControlReq(line)
              continue
            }

            // Pass through to downstream
            controller.enqueue(encoder.encode(`${line}\n`))
            return
          }

          // Need more data
          const { done, value } = await reader.read()
          if (done) {
            // Flush remaining buffer
            if (buffer.trim()) {
              if (!isControlReq(buffer)) {
                controller.enqueue(encoder.encode(`${buffer}\n`))
              } else {
                processControlReq(buffer)
              }
            }
            controller.close()
            return
          }

          buffer += decoder.decode(value, { stream: true })
        }
      },
      cancel() {
        reader.releaseLock()
      },
    })
  }

  private isControlRequest(line: string): boolean {
    // Fast check before full parse
    if (!line.includes('"control_request"')) return false
    try {
      const data = JSON.parse(line)
      return data.type === 'control_request' && data.request_id && data.request
    } catch {
      return false
    }
  }

  private processControlRequest(line: string): void {
    try {
      const data = JSON.parse(line)
      const { request_id, request } = data as {
        request_id: string
        request: ControlRequest
      }
      if (IO_LOG_ENABLED) {
        logger.debug(
          {
            stream: 'stdout-control',
            requestId: request_id,
            subtype: request?.subtype,
            toolName: request?.tool_name,
          },
          'claude_protocol_control_request',
        )
      }
      this.handleControlRequest(request_id, request)
    } catch (error) {
      logger.warn({ error }, 'Failed to parse control request')
    }
  }

  private handleControlRequest(requestId: string, request: ControlRequest): void {
    switch (request.subtype) {
      case 'can_use_tool':
        this.sendResponse(requestId, {
          behavior: 'allow',
          updatedInput: request.input ?? {},
        })
        break

      case 'hook_callback':
        this.sendResponse(requestId, {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        })
        break

      default:
        logger.warn({ subtype: request.subtype, requestId }, 'Unknown control request subtype')
        this.sendError(requestId, `Unknown control request subtype: ${request.subtype}`)
    }
  }

  private sendResponse(requestId: string, payload: unknown): void {
    this.writeJson({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: payload,
      },
    })
  }

  private sendError(requestId: string, error: string): void {
    this.writeJson({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    })
  }

  sendUserMessage(content: string): void {
    this.writeJson({
      type: 'user',
      message: { role: 'user', content },
    })
  }

  async interrupt(): Promise<void> {
    this.writeJson({
      type: 'control_request',
      request_id: ulid(),
      request: { subtype: 'interrupt' },
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.stdin.end()
    } catch {
      /* already closed */
    }
  }

  private writeJson(data: unknown): void {
    if (this.closed) return
    try {
      const json = JSON.stringify(data)
      if (IO_LOG_ENABLED) {
        logger.debug({ stream: 'stdin', line: clipForLog(json) }, 'claude_protocol_io')
      }
      this.stdin.write(`${json}\n`)
      this.stdin.flush?.()
    } catch (error) {
      logger.warn({ error }, 'Failed to write to Claude stdin')
    }
  }
}
