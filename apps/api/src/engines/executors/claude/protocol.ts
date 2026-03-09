import { ulid } from 'ulid'
import type { StdinWriter } from '@/engines/spawn'
import type { PermissionPolicy } from '@/engines/types'
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
  // Skip input_json_delta — extremely high frequency, no debug value
  if (line.includes('"type":"stream_event"') && line.includes('"input_json_delta"')) {
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
  private stdin: StdinWriter
  private closed = false
  /**
   * Called when ANY stdout data is received from the process, signaling it is alive.
   *  Used by the engine layer to update lastActivityAt at the earliest possible point,
   *  before downstream consumers (consumeStream) process the data. This prevents
   *  false stall detection when downstream processing (DB writes, etc.) is slow.
   */
  onActivity?: () => void
  /** Called when a Result message is received, signaling turn completion. */
  onResult?: (data: unknown) => void

  constructor(stdin: StdinWriter) {
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
    const isResultMsg = this.isResultMessage.bind(this)
    // Capture `this` reference instead of the callback value so that
    // onResult/onActivity can be set after wrapStdout() is called.
    const self = this

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
                {
                  stream: 'stdout',
                  line: clipForLog(sanitizeResultLine(line)),
                },
                'claude_protocol_io',
              )
            }

            // Try to parse as control_request
            if (isControlReq(line)) {
              processControlReq(line)
              continue
            }

            // Detect Result message — signals turn completion.
            // The process stays alive between turns (stream-json mode),
            // so we pass the Result through but do NOT close the stream.
            // The downstream consumeStream detects turnCompleted entries
            // and handles settlement without requiring stream closure.
            if (isResultMsg(line)) {
              self.onResult?.(JSON.parse(line))
              controller.enqueue(encoder.encode(`${line}\n`))
              return
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

          // Signal activity at the earliest point — raw data received from process.
          // This fires before line parsing and downstream consumption, ensuring
          // lastActivityAt is updated even if downstream processing is slow.
          self.onActivity?.()

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

  private isResultMessage(line: string): boolean {
    if (!line.includes('"type":"result"')) return false
    try {
      return JSON.parse(line)?.type === 'result'
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
      // onActivity is already called in the pull() loop when raw data arrives,
      // but control_requests are filtered from the downstream stream — fire again
      // to ensure the timestamp is fresh for the completed control_request.
      this.onActivity?.()
      this.handleControlRequest(request_id, request)
    } catch (error) {
      logger.warn({ error }, 'Failed to parse control request')
    }
  }

  private handleControlRequest(requestId: string, request: ControlRequest): void {
    switch (request.subtype) {
      case 'can_use_tool':
        if (request.tool_name === 'ExitPlanMode') {
          // Auto-approve ExitPlanMode and switch permission mode back to
          // bypassPermissions so Claude can execute the plan freely.
          this.sendResponse(requestId, {
            behavior: 'allow',
            updatedInput: request.input ?? {},
            updatedPermissions: [
              {
                type: 'setMode',
                mode: 'bypassPermissions',
                destination: 'session',
              },
            ],
          })
        } else {
          this.sendResponse(requestId, {
            behavior: 'allow',
            updatedInput: request.input ?? {},
          })
        }
        break

      case 'hook_callback':
        // For tool_approval callbacks (ExitPlanMode, AskUserQuestion in plan mode),
        // respond with "ask" to route through can_use_tool where we handle
        // the permission mode switch. All other hooks are auto-approved.
        if (request.callback_id === 'tool_approval') {
          this.sendResponse(requestId, {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'ask',
              permissionDecisionReason: 'Forwarding to can_use_tool for permission handling',
            },
          })
        } else {
          this.sendResponse(requestId, {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
            },
          })
        }
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

  /**
   * Send SDK initialize control request.
   * Tells Claude Code we speak the stream-json SDK protocol and support
   * tool_approval (can_use_tool / hook_callback control requests).
   * Optionally sends hooks configuration for PreToolUse / Stop callbacks.
   */
  initialize(hooks?: Record<string, unknown>): void {
    this.writeJson({
      type: 'control_request',
      request_id: ulid(),
      request: {
        subtype: 'initialize',
        ...(hooks && { hooks }),
      },
    })
  }

  /**
   * Set the SDK permission mode.
   * This replaces CLI-level permission flags (e.g. --dangerously-skip-permissions)
   * with a proper SDK control request.
   */
  setPermissionMode(policy: PermissionPolicy): void {
    const sdkMode = mapPermissionMode(policy)
    this.writeJson({
      type: 'control_request',
      request_id: ulid(),
      request: {
        subtype: 'set_permission_mode',
        mode: sdkMode,
      },
    })
  }

  sendUserMessage(content: string): void {
    this.writeJson({
      type: 'user',
      message: { role: 'user', content },
    })
  }

  /** Fire-and-forget: writes the interrupt request to stdin synchronously. */
  interrupt(): void {
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
    if (this.closed) {
      logger.warn({ data }, 'stdin_write_dropped_closed')
      return
    }
    try {
      const json = JSON.stringify(data)
      if (IO_LOG_ENABLED) {
        logger.debug({ stream: 'stdin', line: clipForLog(json) }, 'claude_protocol_io')
      }
      this.stdin.write(`${json}\n`)
      this.stdin.flush?.()
    } catch (error) {
      logger.error({ error }, 'stdin_write_failed_closing')
      // Close stdin so Claude Code detects broken pipe and exits,
      // rather than waiting forever for a response that was never delivered.
      this.close()
    }
  }
}

// ---------- Helpers ----------

/** Map our PermissionPolicy to Claude SDK permission mode string. */
function mapPermissionMode(policy: PermissionPolicy): 'bypassPermissions' | 'plan' | 'default' {
  switch (policy) {
    case 'auto':
      return 'bypassPermissions'
    case 'plan':
      return 'plan'
    case 'supervised':
      return 'default'
    default:
      return 'bypassPermissions'
  }
}
