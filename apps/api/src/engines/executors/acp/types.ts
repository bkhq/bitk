import type {
  LoadSessionResponse,
  NewSessionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'

export type SessionBootstrap = NewSessionResponse | LoadSessionResponse

export interface AcpEvent {
  type:
    | 'acp-init'
    | 'acp-session-start'
    | 'acp-session-load'
    | 'acp-session-update'
    | 'acp-error'
    | 'acp-prompt-result'
  timestamp: string
  sessionId?: string
  agentInfo?: Record<string, unknown>
  models?: {
    availableModels?: Array<{ modelId: string, name: string, description?: string }>
    currentModelId?: string
  }
  modes?: {
    availableModes?: Array<{ id: string, name: string, description?: string }>
    currentModeId?: string
  }
  update?: SessionNotification['update']
  stopReason?: string
  durationMs?: number
  error?: string
  code?: string | number
}

export interface EventSink {
  stream: ReadableStream<Uint8Array>
  emit: (event: AcpEvent) => void
  close: () => void
}

export interface AcpNormalizeState {
  assistantTextParts: string[]
  toolCalls: Map<string, AcpToolState>
}

export interface AcpToolLocation {
  path: string
  line?: number | null
}

export interface AcpToolState {
  toolCallId: string
  title: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  content?: unknown[] | null
  locations?: AcpToolLocation[] | null
  actionEmitted: boolean
  resultEmitted: boolean
}
