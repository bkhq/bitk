import { classifyCommand } from '@/engines/logs'
import type { NormalizedLogEntry, ToolAction } from '@/engines/types'

// ---------- Types for Codex event protocol ----------

/**
 * Codex wraps events in `codex/event/*` notifications:
 * { method: "codex/event/xxx", params: { msg: { type: "...", ... }, ... } }
 *
 * The `msg` field contains the actual event.
 */

interface CodexEventParams {
  msg?: {
    type?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

// ---------- Stateful normalizer ----------

/**
 * Stateful Codex log normalizer that handles the `codex/event/*` protocol
 * and maintains per-item state for proper streaming updates.
 *
 * Modeled after the Rust reference implementation in `tmp/exec/src/executors/codex/normalize_logs.rs`.
 */
export class CodexLogNormalizer {
  private assistantText = ''
  private thinkingText = ''

  /**
   * Parse a single stdout line and return normalized log entries.
   * Returns null for lines that should be skipped.
   */
  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const now = new Date().toISOString()

    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawLine)
    } catch {
      // Non-JSON — treat as plain text system message
      if (rawLine.trim()) {
        return {
          entryType: 'system-message',
          content: rawLine,
          timestamp: now,
        }
      }
      return null
    }

    const method = data.method as string | undefined

    // -- Handle JSON-RPC responses (session ID / model params extraction) --
    if ('id' in data && 'result' in data && !method) {
      return this.handleResponse(data, now)
    }

    // -- No method field — not a notification we handle --
    if (!method) return null

    // -- codex/event/* notifications (new v2 protocol) --
    if (method.startsWith('codex/event')) {
      return this.handleCodexEvent(data, now)
    }

    // -- Legacy raw notifications --
    switch (method) {
      case 'item/agentMessage/delta':
        return null // Skip individual deltas — use codex/event instead

      case 'item/started':
        return this.handleItemStarted(data, now)

      case 'item/completed':
        return this.handleItemCompleted(data, now)

      case 'item/commandExecution/outputDelta':
        return this.handleCommandOutputDelta(data, now)

      case 'item/fileChange/outputDelta':
        return this.handleFileChangeOutputDelta(data, now)

      case 'turn/started':
        return this.handleTurnStarted(data, now)

      case 'turn/completed':
        return this.handleTurnCompleted(data, now)

      case 'thread/started':
        return this.handleThreadStarted(data, now)

      case 'thread/status/changed':
        return this.handleThreadStatusChanged(data, now)

      case 'error':
        return this.handleError(data, now)

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        return null // Skip reasoning deltas

      default:
        return null
    }
  }

  // ---------- codex/event/* handler ----------

  private handleCodexEvent(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const params = data.params as CodexEventParams | undefined
    const msg = params?.msg
    if (!msg?.type) return null

    const eventType = msg.type as string

    switch (eventType) {
      // --- Assistant message (streaming delta) ---
      case 'agent_message_delta': {
        const delta = (msg.delta as string) ?? ''
        if (!delta) return null
        this.thinkingText = ''
        this.assistantText += delta
        return {
          entryType: 'assistant-message',
          content: this.assistantText,
          timestamp: now,
          metadata: { streaming: true },
        }
      }

      // --- Assistant message (complete) ---
      case 'agent_message': {
        const message = (msg.message as string) ?? ''
        this.thinkingText = ''
        this.assistantText = message
        const entry: NormalizedLogEntry = {
          entryType: 'assistant-message',
          content: message,
          timestamp: now,
        }
        // Reset for next message
        this.assistantText = ''
        return entry
      }

      // --- Reasoning (thinking) delta ---
      case 'agent_reasoning_delta': {
        const delta = (msg.delta as string) ?? ''
        if (!delta) return null
        this.assistantText = ''
        this.thinkingText += delta
        return {
          entryType: 'thinking',
          content: this.thinkingText,
          timestamp: now,
          metadata: { streaming: true },
        }
      }

      // --- Reasoning (thinking) complete ---
      case 'agent_reasoning': {
        const text = (msg.text as string) ?? ''
        this.assistantText = ''
        this.thinkingText = text
        const entry: NormalizedLogEntry = {
          entryType: 'thinking',
          content: text,
          timestamp: now,
        }
        this.thinkingText = ''
        return entry
      }

      // --- Reasoning section break ---
      case 'agent_reasoning_section_break': {
        this.assistantText = ''
        this.thinkingText = ''
        return null
      }

      // --- Command execution begin ---
      case 'exec_command_begin': {
        this.resetStreamingState()
        const command = msg.command as string[] | undefined
        const commandStr = command?.join(' ') ?? ''
        if (!commandStr) return null
        const callId = msg.call_id as string | undefined
        const cwd = msg.cwd as string | undefined
        const source = msg.source as string | undefined
        const parsedCmd = msg.parsed_cmd as unknown[] | undefined
        const description = extractParsedCmdDescription(parsedCmd)
        const toolAction: ToolAction = {
          kind: 'command-run',
          command: commandStr,
          category: classifyCommand(commandStr),
        }
        return {
          entryType: 'tool-use',
          content: `Tool: Bash`,
          timestamp: now,
          metadata: {
            toolName: 'Bash',
            toolCallId: callId,
            input: {
              command: commandStr,
              ...(description && { description }),
            },
            ...(cwd && { cwd }),
            ...(source && { source }),
          },
          toolAction,
        }
      }

      // --- Command execution output delta ---
      case 'exec_command_output_delta': {
        const chunk = msg.chunk as string | undefined
        const stream = msg.stream as string | undefined
        if (!chunk) return null
        return {
          entryType: 'tool-use',
          content: chunk,
          timestamp: now,
          metadata: {
            isResult: true,
            streaming: true,
            outputStream: stream,
          },
        }
      }

      // --- Command execution end ---
      case 'exec_command_end': {
        const command = msg.command as string[] | undefined
        const commandStr = command?.join(' ') ?? ''
        const exitCode = msg.exit_code as number | undefined
        const formattedOutput = (msg.formatted_output as string) ?? ''
        const callId = msg.call_id as string | undefined
        const duration = msg.duration as string | undefined
        const toolAction: ToolAction = {
          kind: 'command-run',
          command: commandStr,
          result: formattedOutput || undefined,
          category: commandStr ? classifyCommand(commandStr) : 'other',
        }
        return {
          entryType: 'tool-use',
          content: formattedOutput,
          timestamp: now,
          metadata: {
            toolName: 'Bash',
            isResult: true,
            toolCallId: callId,
            exitCode,
            ...(duration && { duration }),
          },
          toolAction,
        }
      }

      // --- File patch begin ---
      case 'patch_apply_begin': {
        this.resetStreamingState()
        const changes = msg.changes as Record<string, unknown> | undefined
        const callId = msg.call_id as string | undefined
        const autoApproved = msg.auto_approved as boolean | undefined
        if (!changes) return null
        const entries: NormalizedLogEntry[] = []
        for (const [path, fileChange] of Object.entries(changes)) {
          const input = codexFileChangeToInput(path, fileChange)
          const toolAction: ToolAction = {
            kind: 'file-edit',
            path,
          }
          entries.push({
            entryType: 'tool-use',
            content: `Tool: Edit`,
            timestamp: now,
            metadata: {
              toolName: 'Edit',
              toolCallId: callId,
              path,
              input,
              ...(autoApproved !== undefined && { autoApproved }),
            },
            toolAction,
          })
        }
        return entries.length === 1 ? entries[0] : entries.length > 0 ? entries : null
      }

      // --- File patch end ---
      case 'patch_apply_end': {
        const success = msg.success as boolean | undefined
        const callId = msg.call_id as string | undefined
        const stdout = (msg.stdout as string) ?? ''
        const stderr = (msg.stderr as string) ?? ''
        const changes = msg.changes as Record<string, unknown> | undefined
        // Build result content from stdout/stderr if available
        const resultParts: string[] = []
        if (stdout) resultParts.push(stdout)
        if (stderr) resultParts.push(stderr)
        const resultContent = resultParts.length > 0
          ? resultParts.join('\n')
          : (success ? 'Patch applied successfully' : 'Patch apply failed')
        // Extract changed file paths for metadata
        const changedPaths = changes ? Object.keys(changes) : undefined
        return {
          entryType: 'tool-use',
          content: resultContent,
          timestamp: now,
          metadata: {
            toolName: 'Edit',
            isResult: true,
            toolCallId: callId,
            exitCode: success ? 0 : 1,
            ...(changedPaths && { changedPaths }),
          },
        }
      }

      // --- Approval request for exec ---
      case 'exec_approval_request': {
        this.resetStreamingState()
        const command = msg.command as string[] | undefined
        const commandStr = command?.join(' ') ?? ''
        const callId = msg.call_id as string | undefined
        const cwd = msg.cwd as string | undefined
        const reason = msg.reason as string | null | undefined
        const parsedCmd = msg.parsed_cmd as unknown[] | undefined
        const description = extractParsedCmdDescription(parsedCmd)
        const toolAction: ToolAction = {
          kind: 'command-run',
          command: commandStr,
          category: commandStr ? classifyCommand(commandStr) : 'other',
        }
        return {
          entryType: 'tool-use',
          content: `Tool: Bash`,
          timestamp: now,
          metadata: {
            toolName: 'Bash',
            toolCallId: callId,
            input: {
              command: commandStr,
              ...(description && { description }),
            },
            ...(cwd && { cwd }),
            ...(reason && { reason }),
          },
          toolAction,
        }
      }

      // --- Approval request for file patch ---
      case 'apply_patch_approval_request': {
        this.resetStreamingState()
        const changes = msg.changes as Record<string, unknown> | undefined
        const callId = msg.call_id as string | undefined
        const reason = msg.reason as string | null | undefined
        if (!changes) return null
        const entries: NormalizedLogEntry[] = []
        for (const [path, fileChange] of Object.entries(changes)) {
          const input = codexFileChangeToInput(path, fileChange)
          entries.push({
            entryType: 'tool-use',
            content: `Tool: Edit`,
            timestamp: now,
            metadata: {
              toolName: 'Edit',
              toolCallId: callId,
              path,
              input,
              ...(reason && { reason }),
            },
            toolAction: { kind: 'file-edit', path },
          })
        }
        return entries.length === 1 ? entries[0] : entries.length > 0 ? entries : null
      }

      // --- MCP tool call begin ---
      case 'mcp_tool_call_begin': {
        this.resetStreamingState()
        const invocation = msg.invocation as
          | {
            server?: string
            tool?: string
            arguments?: unknown
          } |
          undefined
        if (!invocation) return null
        const toolName = `mcp:${invocation.server ?? 'unknown'}:${invocation.tool ?? 'unknown'}`
        return {
          entryType: 'tool-use',
          content: `Tool: ${toolName}`,
          timestamp: now,
          metadata: {
            toolName,
            toolCallId: msg.call_id as string | undefined,
            input: invocation.arguments,
          },
          toolAction: {
            kind: 'tool',
            toolName,
            arguments: invocation.arguments,
          },
        }
      }

      // --- MCP tool call end ---
      // Schema: result is { Ok: CallToolResult } | { Err: string }
      // CallToolResult = { content: Array<{type,text,...}>, isError?: boolean }
      case 'mcp_tool_call_end': {
        const invocation = msg.invocation as
          | {
            server?: string
            tool?: string
          } |
          undefined
        const rawResult = msg.result as Record<string, unknown> | undefined
        const toolName = `mcp:${invocation?.server ?? 'unknown'}:${invocation?.tool ?? 'unknown'}`
        const duration = msg.duration as string | undefined

        // Unwrap Ok/Err envelope (schema: { Ok: CallToolResult } | { Err: string })
        let callToolResult: { content?: unknown[], isError?: boolean, is_error?: boolean } | undefined
        let isError = false
        if (rawResult && 'Ok' in rawResult) {
          callToolResult = rawResult.Ok as typeof callToolResult
        } else if (rawResult && 'Err' in rawResult) {
          isError = true
        } else {
          // Fallback: treat raw result as CallToolResult directly (backwards compat)
          callToolResult = rawResult as typeof callToolResult
        }

        if (callToolResult) {
          isError = callToolResult.isError ?? callToolResult.is_error ?? isError
        }

        // Extract text content from MCP result
        let resultText = ''
        if (callToolResult && Array.isArray(callToolResult.content)) {
          resultText = callToolResult.content
            .filter((block: unknown) => {
              const b = block as Record<string, unknown>
              return b?.type === 'text'
            })
            .map((block: unknown) => (block as Record<string, unknown>).text as string)
            .join('\n')
        }

        // If it was an Err string, use that as content
        if (isError && !resultText && rawResult && 'Err' in rawResult) {
          resultText = String(rawResult.Err)
        }

        return {
          entryType: 'tool-use',
          content: resultText || (isError ? 'MCP tool call failed' : 'MCP tool call completed'),
          timestamp: now,
          metadata: {
            toolName,
            isResult: true,
            toolCallId: msg.call_id as string | undefined,
            exitCode: isError ? 1 : 0,
            ...(duration && { duration }),
          },
          toolAction: {
            kind: 'tool',
            toolName,
            result: resultText || undefined,
          },
        }
      }

      // --- Web search begin ---
      case 'web_search_begin': {
        this.resetStreamingState()
        return {
          entryType: 'tool-use',
          content: 'Tool: WebSearch',
          timestamp: now,
          metadata: {
            toolName: 'WebSearch',
            toolCallId: msg.call_id as string | undefined,
          },
          toolAction: { kind: 'web-fetch', url: '...' },
        }
      }

      // --- Web search end ---
      case 'web_search_end': {
        const query = (msg.query as string) ?? ''
        const action = msg.action as string | Record<string, unknown> | undefined
        const actionType = typeof action === 'string'
          ? action
          : (action as Record<string, unknown> | undefined)?.type as string | undefined
        return {
          entryType: 'tool-use',
          content: query || 'Web search completed',
          timestamp: now,
          metadata: {
            toolName: 'WebSearch',
            isResult: true,
            toolCallId: msg.call_id as string | undefined,
            ...(actionType && { actionType }),
          },
          toolAction: { kind: 'web-fetch', url: query },
        }
      }

      // --- View image tool call ---
      case 'view_image_tool_call': {
        this.resetStreamingState()
        const path = (msg.path as string) ?? ''
        return {
          entryType: 'tool-use',
          content: `View image: ${path}`,
          timestamp: now,
          metadata: { toolName: 'ViewImage', path },
          toolAction: { kind: 'file-read', path },
        }
      }

      // --- Plan delta (streaming plan text) ---
      case 'plan_delta': {
        const delta = (msg.delta as string) ?? ''
        if (!delta) return null
        this.thinkingText = ''
        this.assistantText += delta
        return {
          entryType: 'assistant-message',
          content: this.assistantText,
          timestamp: now,
          metadata: { streaming: true, isPlan: true },
        }
      }

      // --- Plan update (todo-like step list) ---
      case 'plan_update': {
        this.resetStreamingState()
        const plan = msg.plan as Array<{ step: string, status: string }> | undefined
        const explanation = msg.explanation as string | undefined
        if (!plan) return null
        const content = explanation?.trim() || `Plan updated (${plan.length} steps)`
        return {
          entryType: 'system-message',
          content,
          timestamp: now,
          metadata: { subtype: 'plan_update', plan },
        }
      }

      // --- Stream error ---
      case 'stream_error': {
        const message = (msg.message as string) ?? 'Stream error'
        return {
          entryType: 'error-message',
          content: `Stream error: ${message}`,
          timestamp: now,
        }
      }

      // --- Error ---
      case 'error': {
        const message = (msg.message as string) ?? 'Unknown error'
        const errorInfo = msg.codex_error_info as string | Record<string, unknown> | null | undefined
        const errorType = extractCodexErrorType(errorInfo)
        return {
          entryType: 'error-message',
          content: `Error: ${message}`,
          timestamp: now,
          metadata: {
            ...(errorType && { errorType }),
          },
        }
      }

      // --- Warning ---
      case 'warning': {
        const message = (msg.message as string) ?? ''
        if (!message) return null
        return {
          entryType: 'error-message',
          content: message,
          timestamp: now,
        }
      }

      // --- Model reroute ---
      case 'model_reroute': {
        const fromModel = (msg.from_model as string) ?? ''
        const toModel = (msg.to_model as string) ?? ''
        return {
          entryType: 'system-message',
          content: `Model rerouted from ${fromModel} to ${toModel}`,
          timestamp: now,
        }
      }

      // --- Token count / context usage ---
      case 'token_count': {
        const info = msg.info as
          | {
            last_token_usage?: { total_tokens?: number, input_tokens?: number, output_tokens?: number }
            model_context_window?: number
          } |
          undefined
        const rateLimits = msg.rate_limits as Record<string, unknown> | null | undefined
        if (!info?.last_token_usage) return null
        const totalTokens = info.last_token_usage.total_tokens ?? 0
        const contextWindow = info.model_context_window ?? 0
        return {
          entryType: 'token-usage',
          content: `Tokens: ${totalTokens} / Context: ${contextWindow}`,
          timestamp: now,
          metadata: {
            totalTokens,
            contextWindow,
            ...(info.last_token_usage.input_tokens != null && { inputTokens: info.last_token_usage.input_tokens }),
            ...(info.last_token_usage.output_tokens != null && { outputTokens: info.last_token_usage.output_tokens }),
            ...(rateLimits && { rateLimits }),
          },
        }
      }

      // --- Context compacted ---
      case 'context_compacted': {
        return {
          entryType: 'system-message',
          content: 'Context compacted',
          timestamp: now,
        }
      }

      // --- Session configured ---
      case 'session_configured': {
        const model = (msg.model as string) ?? ''
        const sessionId = (msg.session_id as string) ?? ''
        const modelProviderId = msg.model_provider_id as string | undefined
        const cwd = msg.cwd as string | undefined
        const approvalPolicy = msg.approval_policy as string | undefined
        const reasoningEffort = msg.reasoning_effort as string | null | undefined
        const forkedFromId = msg.forked_from_id as string | null | undefined
        const threadName = msg.thread_name as string | undefined
        const parts: string[] = []
        if (model) parts.push(`model: ${model}`)
        if (modelProviderId) parts.push(`provider: ${modelProviderId}`)
        return {
          entryType: 'system-message',
          content: parts.length > 0 ? parts.join('  ') : 'Session configured',
          timestamp: now,
          metadata: {
            subtype: 'session_configured',
            sessionId,
            model,
            ...(modelProviderId && { modelProviderId }),
            ...(cwd && { cwd }),
            ...(approvalPolicy && { approvalPolicy }),
            ...(reasoningEffort && { reasoningEffort }),
            ...(forkedFromId && { forkedFromId }),
            ...(threadName && { threadName }),
          },
        }
      }

      // --- Background event ---
      case 'background_event': {
        const message = (msg.message as string) ?? ''
        if (!message) return null
        return {
          entryType: 'system-message',
          content: `Background event: ${message}`,
          timestamp: now,
        }
      }

      // --- Turn started (v2 codex/event) ---
      // Schema type discriminant is "task_started" in EventMsg but "turn_started" in our events
      case 'turn_started':
      case 'task_started': {
        const turnId = msg.turn_id as string | undefined
        const contextWindow = msg.model_context_window as number | null | undefined
        const collabMode = msg.collaboration_mode_kind as string | undefined
        return {
          entryType: 'system-message',
          content: 'Turn started',
          timestamp: now,
          metadata: {
            subtype: 'turn_started',
            ...(turnId && { turnId }),
            ...(contextWindow != null && { contextWindow }),
            ...(collabMode && { collabMode }),
          },
        }
      }

      // --- Turn complete (v2 codex/event) ---
      // Schema type discriminant is "task_complete" in EventMsg but "turn_complete" in our events
      // Note: last_agent_message is NOT used as content because the same text was already
      // streamed via agent_message_delta / agent_message events as assistant-message entries.
      // Using it here would produce a duplicate system-message with identical content.
      case 'turn_complete':
      case 'task_complete': {
        this.resetStreamingState()
        const turnId = msg.turn_id as string | undefined
        return {
          entryType: 'system-message',
          content: 'Turn completed',
          timestamp: now,
          metadata: {
            turnCompleted: true,
            ...(turnId && { turnId }),
          },
        }
      }

      // --- Item started (plan item) ---
      case 'item_started': {
        const item = msg.item as Record<string, unknown> | undefined
        if (item?.type === 'plan' || item?.type === 'Plan') {
          this.resetStreamingState()
          return {
            entryType: 'system-message',
            content: 'Plan generation started',
            timestamp: now,
            metadata: { subtype: 'plan_started', itemId: item.id },
          }
        }
        return null
      }

      // --- Item completed (plan item) ---
      case 'item_completed': {
        const item = msg.item as Record<string, unknown> | undefined
        if (item?.type === 'plan' || item?.type === 'Plan') {
          const text = (item.text as string) ?? ''
          if (text) {
            return {
              entryType: 'assistant-message',
              content: text,
              timestamp: now,
              metadata: { isPlan: true },
            }
          }
        }
        return null
      }

      // --- Request user input (interactive questions) ---
      case 'request_user_input': {
        const callId = msg.call_id as string | undefined
        const questions = msg.questions as Array<{ question?: string, header?: string }> | undefined
        const questionText = questions?.map(q => q.question || q.header || '').filter(Boolean).join('\n') || 'User input requested'
        return {
          entryType: 'system-message',
          content: questionText,
          timestamp: now,
          metadata: {
            subtype: 'request_user_input',
            toolCallId: callId,
            questions,
          },
        }
      }

      // --- Dynamic tool call request ---
      case 'dynamic_tool_call_request': {
        this.resetStreamingState()
        const callId = msg.callId as string | undefined
        const toolName = (msg.tool as string) ?? 'unknown'
        const args = msg.arguments
        return {
          entryType: 'tool-use',
          content: `Tool: ${toolName}`,
          timestamp: now,
          metadata: {
            toolName,
            toolCallId: callId,
            input: args,
          },
          toolAction: {
            kind: 'tool',
            toolName,
            arguments: args,
          },
        }
      }

      // --- Terminal interaction (interactive stdin) ---
      case 'terminal_interaction': {
        const callId = msg.call_id as string | undefined
        const stdin = (msg.stdin as string) ?? ''
        return {
          entryType: 'system-message',
          content: `Terminal input: ${stdin}`,
          timestamp: now,
          metadata: {
            subtype: 'terminal_interaction',
            toolCallId: callId,
            processId: msg.process_id as string | undefined,
          },
        }
      }

      // --- Review mode events ---
      case 'entered_review_mode': {
        const hint = msg.user_facing_hint as string | undefined
        return {
          entryType: 'system-message',
          content: hint || 'Entered review mode',
          timestamp: now,
          metadata: { subtype: 'entered_review_mode' },
        }
      }

      case 'exited_review_mode': {
        return {
          entryType: 'system-message',
          content: 'Exited review mode',
          timestamp: now,
          metadata: { subtype: 'exited_review_mode' },
        }
      }

      // --- Collaboration events ---
      case 'collab_agent_spawn_begin': {
        const callId = msg.call_id as string | undefined
        const prompt = (msg.prompt as string) ?? ''
        return {
          entryType: 'system-message',
          content: prompt ? `Spawning agent: ${prompt.slice(0, 100)}` : 'Spawning agent',
          timestamp: now,
          metadata: {
            subtype: 'collab_agent_spawn_begin',
            toolCallId: callId,
            senderThreadId: msg.sender_thread_id as string | undefined,
          },
        }
      }

      case 'collab_agent_spawn_end': {
        const newThreadId = msg.new_thread_id as string | null | undefined
        const status = msg.status as string | Record<string, unknown> | undefined
        const statusStr = typeof status === 'string' ? status : 'unknown'
        return {
          entryType: 'system-message',
          content: `Agent spawned: ${statusStr}`,
          timestamp: now,
          metadata: {
            subtype: 'collab_agent_spawn_end',
            ...(newThreadId && { newThreadId }),
            agentStatus: status,
          },
        }
      }

      case 'collab_agent_interaction_begin': {
        const callId = msg.call_id as string | undefined
        const prompt = (msg.prompt as string) ?? ''
        return {
          entryType: 'system-message',
          content: prompt ? `Agent interaction: ${prompt.slice(0, 100)}` : 'Agent interaction started',
          timestamp: now,
          metadata: {
            subtype: 'collab_agent_interaction_begin',
            toolCallId: callId,
          },
        }
      }

      case 'collab_agent_interaction_end': {
        const status = msg.status as string | Record<string, unknown> | undefined
        const statusStr = typeof status === 'string' ? status : 'completed'
        return {
          entryType: 'system-message',
          content: `Agent interaction ended: ${statusStr}`,
          timestamp: now,
          metadata: { subtype: 'collab_agent_interaction_end', agentStatus: status },
        }
      }

      case 'collab_waiting_begin': {
        const receiverIds = msg.receiver_thread_ids as string[] | undefined
        return {
          entryType: 'system-message',
          content: `Waiting for ${receiverIds?.length ?? 0} agent(s)`,
          timestamp: now,
          metadata: { subtype: 'collab_waiting_begin', receiverIds },
        }
      }

      case 'collab_waiting_end': {
        return {
          entryType: 'system-message',
          content: 'Agent wait completed',
          timestamp: now,
          metadata: { subtype: 'collab_waiting_end' },
        }
      }

      // --- Elicitation request (MCP server asking for user input) ---
      case 'elicitation_request': {
        const serverName = (msg.server_name as string) ?? 'unknown'
        const elicitMessage = (msg.message as string) ?? ''
        return {
          entryType: 'system-message',
          content: elicitMessage || `MCP server ${serverName} requests input`,
          timestamp: now,
          metadata: {
            subtype: 'elicitation_request',
            serverName,
          },
        }
      }

      // --- Turn aborted ---
      case 'turn_aborted': {
        this.resetStreamingState()
        return {
          entryType: 'system-message',
          content: 'Turn aborted',
          timestamp: now,
          metadata: { turnCompleted: true },
        }
      }

      // --- Skip events (no useful data to extract) ---
      case 'mcp_startup_update':
      case 'mcp_startup_complete':
      case 'mcp_list_tools_response':
      case 'user_message':
      case 'turn_diff':
      case 'deprecation_notice':
      case 'raw_response_item':
      case 'undo_started':
      case 'undo_completed':
      case 'thread_rolled_back':
      case 'thread_name_updated':
      case 'shutdown_complete':
      case 'get_history_entry_response':
      case 'list_custom_prompts_response':
      case 'list_skills_response':
      case 'skills_update_available':
      case 'agent_message_content_delta':
      case 'reasoning_content_delta':
      case 'reasoning_raw_content_delta':
      case 'agent_reasoning_raw_content':
      case 'agent_reasoning_raw_content_delta':
      case 'collab_close_begin':
      case 'collab_close_end':
      case 'collab_resume_begin':
      case 'collab_resume_end':
      case 'dynamic_tool_call_response':
      case 'list_remote_skills_response':
      case 'remote_skill_downloaded':
      case 'realtime_conversation_started':
      case 'realtime_conversation_realtime':
      case 'realtime_conversation_closed':
        return null

      default:
        return null
    }
  }

  // ---------- Legacy notification handlers (fallback) ----------

  private handleResponse(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    // Extract session ID from thread/start or thread/fork responses
    const result = data.result as Record<string, unknown> | undefined
    if (!result) return null
    const thread = result.thread as Record<string, unknown> | undefined
    if (thread?.id) {
      const model = (result.model as string) ?? ''
      const parts: string[] = []
      if (model) parts.push(`model: ${model}`)
      if (parts.length > 0) {
        return {
          entryType: 'system-message',
          content: parts.join('  '),
          timestamp: now,
          metadata: { subtype: 'session_configured', model },
        }
      }
    }
    return null
  }

  private handleItemStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const item = (params.item ?? {}) as Record<string, unknown>
    const itemType = item.type as string | undefined

    if (itemType === 'commandExecution') {
      this.resetStreamingState()
      const commandStr = extractCommandString(item)
      const toolAction: ToolAction = {
        kind: 'command-run',
        command: commandStr,
        category: commandStr ? classifyCommand(commandStr) : 'other',
      }
      return {
        entryType: 'tool-use',
        content: 'Tool: Bash',
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
      this.resetStreamingState()
      const path = item.path as string | undefined
      return {
        entryType: 'tool-use',
        content: 'Tool: Edit',
        timestamp: now,
        metadata: {
          streaming: true,
          toolName: 'Edit',
          toolCallId: item.id as string | undefined,
          path,
          input: path ? { file_path: path } : undefined,
        },
        toolAction: { kind: 'file-edit', path: path ?? '' },
      }
    }

    if (itemType === 'agentMessage' || itemType === 'reasoning') {
      return null
    }

    return null
  }

  private handleItemCompleted(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const item = (params.item ?? {}) as Record<string, unknown>
    const itemType = item.type as string | undefined

    if (itemType === 'commandExecution') {
      const stdout = (item.stdout as string) ?? ''
      const stderr = (item.stderr as string) ?? ''
      const aggregated = (item.aggregatedOutput as string) ?? ''
      const combined = aggregated || [stdout, stderr].filter(Boolean).join('\n')
      const exitCode = item.exitCode as number | undefined
      const duration = (item.durationMs ?? item.duration) as number | undefined
      const commandStr = extractCommandString(item)
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
        toolAction: {
          kind: 'command-run',
          command: commandStr,
          result: combined || undefined,
          category: commandStr ? classifyCommand(commandStr) : 'other',
        },
      }
    }

    if (itemType === 'fileChange') {
      const patches = item.patches as unknown[] | undefined
      const path = item.path as string | undefined
      const patchCount = patches?.length ?? 0
      const summary = path
        ? `File changed: ${path} (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`
        : `File changed (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`
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
        toolAction: { kind: 'file-edit', path: path ?? '' },
      }
    }

    // Skip legacy agentMessage — handled by codex/event/agent_message (v2)
    if (itemType === 'agentMessage') {
      return null
    }

    if (itemType === 'reasoning') return null
    return null
  }

  private handleCommandOutputDelta(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: { isResult: true, streaming: true },
    }
  }

  private handleFileChangeOutputDelta(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: { isResult: true, streaming: true },
    }
  }

  private handleTurnStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
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

  private handleTurnCompleted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const turn = (params.turn ?? {}) as Record<string, unknown>
    const usage = (turn.usage ?? {}) as Record<string, unknown>
    const inputTokens = usage.inputTokens as number | undefined
    const outputTokens = usage.outputTokens as number | undefined

    const parts: string[] = []
    if (inputTokens != null) {
      parts.push(
        inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k input` : `${inputTokens} input`,
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

  private handleThreadStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const threadId = params.threadId as string | undefined
    return {
      entryType: 'system-message',
      content: 'Thread started',
      timestamp: now,
      metadata: { subtype: 'thread_started', threadId },
    }
  }

  private handleThreadStatusChanged(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const status = params.status as string | undefined
    if (status === 'systemError') {
      return {
        entryType: 'error-message',
        content: `Thread error: ${(params.message as string) ?? 'system error'}`,
        timestamp: now,
        metadata: { status },
      }
    }
    return null
  }

  private handleError(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
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

  // ---------- Helpers ----------

  private resetStreamingState(): void {
    this.assistantText = ''
    this.thinkingText = ''
  }
}

/**
 * Map a Codex FileChange value to a frontend-compatible input object.
 *
 * Codex FileChange types:
 * - { type: "add", content: string }        → new file (Write-like)
 * - { type: "update", unified_diff: string } → file edit with unified diff
 * - { type: "delete", content: string }      → file deletion
 */
function codexFileChangeToInput(
  path: string,
  fileChange: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = { file_path: path }
  if (!fileChange || typeof fileChange !== 'object') return base

  const fc = fileChange as Record<string, unknown>
  const changeType = fc.type as string | undefined

  switch (changeType) {
    case 'add':
      if (typeof fc.content === 'string') {
        base.content = fc.content
      }
      break
    case 'update':
      if (typeof fc.unified_diff === 'string') {
        base.unified_diff = fc.unified_diff
      }
      break
    case 'delete':
      base.deleted = true
      break
  }

  return base
}

/**
 * Extract a human-readable description from parsed_cmd array.
 * ParsedCommand: { type: "read", path } | { type: "list_files", path } |
 *                { type: "search", query, path } | { type: "unknown", cmd }
 */
function extractParsedCmdDescription(parsedCmd: unknown[] | undefined): string | undefined {
  if (!parsedCmd || parsedCmd.length === 0) return undefined
  const first = parsedCmd[0] as Record<string, unknown> | undefined
  if (!first) return undefined
  switch (first.type) {
    case 'read':
      return `Read ${first.path ?? first.name ?? ''}`
    case 'list_files':
      return `List files${first.path ? ` in ${first.path}` : ''}`
    case 'search':
      return `Search${first.query ? ` "${first.query}"` : ''}${first.path ? ` in ${first.path}` : ''}`
    default:
      return undefined
  }
}

/**
 * Extract a simplified error type string from CodexErrorInfo.
 * CodexErrorInfo is either a plain string like "context_window_exceeded"
 * or an object like { http_connection_failed: { http_status_code: 429 } }.
 */
function extractCodexErrorType(errorInfo: unknown): string | undefined {
  if (!errorInfo) return undefined
  if (typeof errorInfo === 'string') return errorInfo
  if (typeof errorInfo === 'object') {
    const keys = Object.keys(errorInfo as Record<string, unknown>)
    return keys[0] || undefined
  }
  return undefined
}

/**
 * Extract the command string from a Codex item.
 * Codex sends `item.command` as either a string or string[] depending on version.
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
  const actions = item.commandActions as Array<{ command?: unknown }> | undefined
  const rawCmd = actions?.[0]?.command
  if (typeof rawCmd === 'string' && rawCmd) return rawCmd
  return ''
}
