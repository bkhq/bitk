import type { SessionNotification } from '@agentclientprotocol/sdk'
import type {
  NormalizedLogEntry,
  ToolAction,
} from '@/engines/types'
import type {
  AcpEvent,
  AcpNormalizeState,
  AcpToolLocation,
  AcpToolState,
} from './types'

function createNormalizeState(): AcpNormalizeState {
  return {
    assistantTextParts: [],
    toolCalls: new Map(),
  }
}

function resetNormalizeState(state: AcpNormalizeState): void {
  state.assistantTextParts = []
  state.toolCalls.clear()
}

function flushAssistantMessage(
  state: AcpNormalizeState,
  timestamp: string,
): NormalizedLogEntry | null {
  const content = state.assistantTextParts.join('').trim()
  resetNormalizeState(state)
  if (!content) return null
  return {
    entryType: 'assistant-message',
    content,
    timestamp,
  }
}

function normalizeAssistantChunk(
  update: SessionNotification['update'],
  state: AcpNormalizeState,
): NormalizedLogEntry | null {
  if (update.sessionUpdate !== 'agent_message_chunk') return null

  const content = update.content
  if (content.type === 'text') {
    state.assistantTextParts.push(content.text)
    return {
      entryType: 'assistant-message',
      content: content.text,
      timestamp: new Date().toISOString(),
      metadata: { streaming: true },
    }
  }

  return {
    entryType: 'assistant-message',
    content: `[${content.type}]`,
    timestamp: new Date().toISOString(),
    metadata: { streaming: true, contentType: content.type },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ?
      (value as Record<string, unknown>) :
    null
}

function stringifyAcpValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractAcpContentText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map(item => extractAcpContentText(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  const record = asRecord(value)
  if (!record) return ''

  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim()
  if (typeof record.content === 'string' && record.content.trim()) return record.content.trim()
  if (record.content) {
    const nested = extractAcpContentText(record.content)
    if (nested) return nested
  }
  if (typeof record.output === 'string' && record.output.trim()) return record.output.trim()
  if (typeof record.stderr === 'string' && record.stderr.trim()) return record.stderr.trim()
  if (typeof record.stdout === 'string' && record.stdout.trim()) return record.stdout.trim()

  return ''
}

function renderToolCallContent(content: unknown[] | null | undefined): string {
  if (!Array.isArray(content) || content.length === 0) return ''

  return content
    .map((item) => {
      const record = asRecord(item)
      if (!record) return stringifyAcpValue(item)

      if (record.type === 'content') {
        const text = extractAcpContentText(record.content)
        return text || stringifyAcpValue(record.content)
      }

      if (record.type === 'diff') {
        const path =
          typeof record.path === 'string' ? record.path :
            typeof record.newPath === 'string' ? record.newPath :
              typeof record.oldPath === 'string' ? record.oldPath :
                null
        return path ? `Diff: ${path}` : 'Diff generated'
      }

      if (record.type === 'terminal') {
        const text =
          extractAcpContentText(record.output)
          || extractAcpContentText(record.command)
          || extractAcpContentText(record.content)
        return text || 'Terminal output'
      }

      return extractAcpContentText(record) || stringifyAcpValue(record)
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function extractReadableToolOutput(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map(item => extractReadableToolOutput(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  const record = asRecord(value)
  if (!record) return ''

  const preferredKeys = [
    'formatted_output',
    'stdout',
    'aggregated_output',
    'stderr',
    'output',
    'result',
    'text',
    'content',
  ] as const

  for (const key of preferredKeys) {
    const candidate = record[key]
    const text = extractAcpContentText(candidate) || extractReadableToolOutput(candidate)
    if (text) return text
  }

  return ''
}

function normalizeToolLocations(value: unknown): AcpToolLocation[] | null {
  if (!Array.isArray(value)) return null
  const locations = value
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.path !== 'string') return null
      return {
        path: record.path,
        line: typeof record.line === 'number' ? record.line : null,
      } satisfies AcpToolLocation
    })
    .filter(Boolean) as AcpToolLocation[]

  return locations.length > 0 ? locations : null
}

function mapAcpToolKind(kind?: string): string {
  switch (kind) {
    case 'read':
      return 'file-read'
    case 'edit':
    case 'move':
    case 'delete':
      return 'file-edit'
    case 'search':
      return 'search'
    case 'execute':
      return 'command-run'
    case 'fetch':
      return 'web-fetch'
    case 'switch_mode':
    case 'think':
      return 'tool'
    default:
      return 'other'
  }
}

function getToolPath(state: AcpToolState): string | null {
  const firstLocation = state.locations?.[0]?.path
  if (firstLocation) return firstLocation

  const input = asRecord(state.rawInput)
  const candidates = ['path', 'filePath', 'file', 'target', 'from', 'to']
  for (const key of candidates) {
    if (typeof input?.[key] === 'string' && input[key].trim()) {
      return input[key].trim() as string
    }
  }

  return null
}

function buildAcpToolAction(state: AcpToolState): ToolAction {
  const kind = mapAcpToolKind(state.kind)
  const title = state.title || 'ACP Tool'
  const input = asRecord(state.rawInput) ?? undefined

  switch (kind) {
    case 'file-read': {
      const path = getToolPath(state)
      return path ? { kind: 'file-read', path } : { kind: 'tool', toolName: title, arguments: input }
    }
    case 'file-edit': {
      const path = getToolPath(state)
      return path ? { kind: 'file-edit', path } : { kind: 'tool', toolName: title, arguments: input }
    }
    case 'search': {
      const query =
        typeof input?.query === 'string' ? input.query :
          typeof input?.pattern === 'string' ? input.pattern :
            typeof input?.text === 'string' ? input.text :
              title
      return { kind: 'search', query }
    }
    case 'command-run': {
      const command =
        typeof input?.command === 'string' ? input.command :
          typeof input?.cmd === 'string' ? input.cmd :
            title
      return { kind: 'command-run', command }
    }
    case 'web-fetch': {
      const url =
        typeof input?.url === 'string' ? input.url :
          typeof input?.uri === 'string' ? input.uri :
            title
      return { kind: 'web-fetch', url }
    }
    default:
      return { kind: 'tool', toolName: title, arguments: input }
  }
}

function buildAcpToolRaw(state: AcpToolState): Record<string, unknown> {
  return {
    title: state.title,
    kind: state.kind,
    status: state.status,
    rawInput: state.rawInput,
    rawOutput: state.rawOutput,
    content: state.content,
    locations: state.locations,
  }
}

function hasSpecificCommand(state: AcpToolState): boolean {
  const input = asRecord(state.rawInput)
  if (typeof input?.command === 'string' && input.command.trim()) return true
  if (typeof input?.cmd === 'string' && input.cmd.trim()) return true

  const title = state.title.trim()
  return Boolean(title && title !== 'Terminal' && title !== 'ACP Tool')
}

function hasSpecificSearch(state: AcpToolState): boolean {
  const input = asRecord(state.rawInput)
  return Boolean(
    (typeof input?.query === 'string' && input.query.trim())
    || (typeof input?.pattern === 'string' && input.pattern.trim())
    || (typeof input?.text === 'string' && input.text.trim()),
  )
}

function hasSpecificFetchTarget(state: AcpToolState): boolean {
  const input = asRecord(state.rawInput)
  return Boolean(
    (typeof input?.url === 'string' && input.url.trim())
    || (typeof input?.uri === 'string' && input.uri.trim()),
  )
}

function shouldEmitAcpToolAction(state: AcpToolState): boolean {
  const kind = mapAcpToolKind(state.kind)

  switch (kind) {
    case 'file-read':
    case 'file-edit':
      return Boolean(getToolPath(state))
    case 'command-run':
      return hasSpecificCommand(state)
    case 'search':
      return hasSpecificSearch(state)
    case 'web-fetch':
      return hasSpecificFetchTarget(state)
    default:
      return Boolean(
        state.locations?.length
        || asRecord(state.rawInput)
        || renderToolCallContent(state.content),
      )
  }
}

function buildAcpToolEntry(state: AcpToolState): NormalizedLogEntry {
  return {
    entryType: 'tool-use',
    content: state.title || 'ACP Tool',
    timestamp: new Date().toISOString(),
    metadata: {
      toolCallId: state.toolCallId,
      toolName: state.title,
      status: state.status,
      kind: state.kind,
      input: state.rawInput,
      locations: state.locations,
      content: state.content,
    },
    toolAction: buildAcpToolAction(state),
    toolDetail: {
      kind: mapAcpToolKind(state.kind),
      toolName: state.title || 'ACP Tool',
      toolCallId: state.toolCallId,
      isResult: false,
      raw: buildAcpToolRaw(state),
    },
  }
}

function isTerminalToolStatus(status?: string): boolean {
  return status === 'completed' || status === 'failed'
}

function hasRenderableToolOutput(state: AcpToolState): boolean {
  return Boolean(
    renderToolCallContent(state.content)
    || extractReadableToolOutput(state.rawOutput)
    || stringifyAcpValue(state.rawOutput)
    || isTerminalToolStatus(state.status),
  )
}

function buildAcpToolResultContent(state: AcpToolState): string {
  const content = renderToolCallContent(state.content)
  if (content) return content

  const readableOutput = extractReadableToolOutput(state.rawOutput)
  if (readableOutput) return readableOutput

  const rawOutput = stringifyAcpValue(state.rawOutput)
  if (rawOutput) return rawOutput

  if (state.status === 'failed') return 'Tool failed'
  if (state.status === 'completed') return 'Tool completed'
  return 'Tool update received'
}

function buildAcpToolResultEntry(state: AcpToolState, timestamp: string): NormalizedLogEntry {
  return {
    entryType: 'tool-use',
    content: buildAcpToolResultContent(state),
    timestamp,
    metadata: {
      toolCallId: state.toolCallId,
      toolName: state.title,
      status: state.status,
      kind: state.kind,
      isResult: true,
      output: state.rawOutput,
      locations: state.locations,
      content: state.content,
    },
    toolDetail: {
      kind: mapAcpToolKind(state.kind),
      toolName: state.title || 'ACP Tool',
      toolCallId: state.toolCallId,
      isResult: true,
      raw: buildAcpToolRaw(state),
    },
  }
}

function applyToolUpdate(
  current: AcpToolState | undefined,
  update: Record<string, unknown>,
): AcpToolState {
  return {
    toolCallId: typeof update.toolCallId === 'string' ? update.toolCallId : (current?.toolCallId ?? ''),
    title:
      typeof update.title === 'string' && update.title.trim() ?
        update.title :
          (current?.title ?? 'ACP Tool'),
    kind: typeof update.kind === 'string' ? update.kind : current?.kind,
    status: typeof update.status === 'string' ? update.status : current?.status,
    rawInput: Object.hasOwn(update, 'rawInput') ? update.rawInput : current?.rawInput,
    rawOutput: Object.hasOwn(update, 'rawOutput') ? update.rawOutput : current?.rawOutput,
    content: Object.hasOwn(update, 'content') ? ((update.content as unknown[] | null | undefined) ?? null) : current?.content,
    locations: Object.hasOwn(update, 'locations') ? normalizeToolLocations(update.locations) : (current?.locations ?? null),
    actionEmitted: current?.actionEmitted ?? false,
    resultEmitted: current?.resultEmitted ?? false,
  }
}

function normalizeToolUpdate(
  update: SessionNotification['update'],
  state: AcpNormalizeState,
  timestamp: string,
): NormalizedLogEntry | NormalizedLogEntry[] | null {
  if (update.sessionUpdate === 'tool_call') {
    const next = applyToolUpdate(state.toolCalls.get(update.toolCallId), update as Record<string, unknown>)
    if (!next.actionEmitted && shouldEmitAcpToolAction(next)) {
      next.actionEmitted = true
      state.toolCalls.set(update.toolCallId, next)
      return buildAcpToolEntry(next)
    }
    state.toolCalls.set(update.toolCallId, next)
    return null
  }

  if (update.sessionUpdate === 'tool_call_update') {
    const next = applyToolUpdate(state.toolCalls.get(update.toolCallId), update as Record<string, unknown>)
    state.toolCalls.set(update.toolCallId, next)

    const entries: NormalizedLogEntry[] = []

    if (!next.actionEmitted && shouldEmitAcpToolAction(next)) {
      next.actionEmitted = true
      entries.push(buildAcpToolEntry(next))
    }

    const status = typeof update.status === 'string' ? update.status : next.status
    const outputSignal =
      Object.hasOwn(update, 'rawOutput')
      || (Array.isArray(update.content) && update.content.length > 0)

    if (!next.resultEmitted && (isTerminalToolStatus(status) || (!status && outputSignal))) {
      next.resultEmitted = true
      state.toolCalls.set(update.toolCallId, next)
      entries.push(buildAcpToolResultEntry(next, timestamp))
    }

    if (entries.length === 0) return null
    if (entries.length === 1) return entries[0]
    return entries
  }

  return null
}

function flushOutstandingToolResults(
  state: AcpNormalizeState,
  timestamp: string,
): NormalizedLogEntry[] {
  const entries: NormalizedLogEntry[] = []

  for (const [toolCallId, toolState] of state.toolCalls.entries()) {
    if (!toolState.resultEmitted && hasRenderableToolOutput(toolState)) {
      toolState.resultEmitted = true
      entries.push(buildAcpToolResultEntry(toolState, timestamp))
    }
    state.toolCalls.delete(toolCallId)
  }

  return entries
}

function normalizeAcpEventWithState(
  rawLine: string,
  state: AcpNormalizeState,
): NormalizedLogEntry | NormalizedLogEntry[] | null {
  try {
    const event = JSON.parse(rawLine) as AcpEvent

    switch (event.type) {
      case 'acp-init':
        return {
          entryType: 'system-message',
          content: 'ACP session initialized',
          timestamp: event.timestamp,
          metadata: {
            subtype: 'init',
            ...((event.agentInfo && { agentInfo: event.agentInfo }) || {}),
          },
        }

      case 'acp-session-start':
      case 'acp-session-load':
        resetNormalizeState(state)
        return {
          entryType: 'system-message',
          content:
            event.type === 'acp-session-start' ?
              'ACP session started' :
              'ACP session loaded',
          timestamp: event.timestamp,
          metadata: {
            sessionId: event.sessionId,
            modes: event.modes,
            models: event.models,
            type: 'system',
          },
        }

      case 'acp-session-update': {
        const update = event.update
        if (!update) return null

        const assistantChunk = normalizeAssistantChunk(update, state)
        if (assistantChunk) return assistantChunk

        const toolUpdate = normalizeToolUpdate(update, state, event.timestamp)
        if (toolUpdate) return toolUpdate

        if (update.sessionUpdate === 'agent_thought_chunk') {
          return {
            entryType: 'thinking',
            content:
              typeof update.content === 'string' ? update.content : JSON.stringify(update.content),
            timestamp: event.timestamp,
            metadata: { streaming: true },
          }
        }

        if (update.sessionUpdate === 'plan') {
          return {
            entryType: 'system-message',
            content:
              update.entries.map(entry => `${entry.status}: ${entry.content}`).join('\n')
              || 'Plan updated',
            timestamp: event.timestamp,
            metadata: {
              subtype: 'plan',
              entries: update.entries,
            },
          }
        }

        if (update.sessionUpdate === 'current_mode_update') {
          return {
            entryType: 'system-message',
            content: `Mode changed to ${update.currentModeId}`,
            timestamp: event.timestamp,
            metadata: {
              subtype: 'mode',
              mode: update.currentModeId,
              type: 'system',
            },
          }
        }

        return null
      }

      case 'acp-error':
        return {
          entryType: 'error-message',
          content: event.error ?? 'ACP request failed',
          timestamp: event.timestamp,
        }

      case 'acp-prompt-result':
        return [
          ...flushOutstandingToolResults(state, event.timestamp),
          flushAssistantMessage(state, event.timestamp),
          {
            entryType: 'system-message',
            content: `ACP turn completed (${event.stopReason ?? 'unknown'})`,
            timestamp: event.timestamp,
            metadata: {
              turnCompleted: true,
              duration: event.durationMs,
              resultSubtype: event.error ? 'error' : 'success',
              stopReason: event.stopReason,
              ...(event.error ? { error: event.error, isError: true } : {}),
              type: 'system',
            },
          },
        ].filter(Boolean) as NormalizedLogEntry[]

      default:
        return null
    }
  } catch {
    if (!rawLine.trim()) return null
    return {
      entryType: 'system-message',
      content: rawLine,
      timestamp: new Date().toISOString(),
      metadata: { type: 'system' },
    }
  }
}

export function normalizeAcpEvent(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
  return normalizeAcpEventWithState(rawLine, createNormalizeState())
}

export class AcpLogNormalizer {
  private readonly state = createNormalizeState()

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return normalizeAcpEventWithState(rawLine, this.state)
  }
}
