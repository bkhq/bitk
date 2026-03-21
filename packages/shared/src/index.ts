// @bkd/shared — Types shared between @bkd/api and @bkd/frontend
// Re-exported from packages/shared for cross-workspace consumption.

export interface Project {
  id: string
  alias: string
  name: string
  description?: string
  directory?: string
  repositoryUrl?: string
  systemPrompt?: string
  envVars?: Record<string, string>
  sortOrder: string
  isArchived: boolean
  isGitRepo: boolean
  createdAt: string
  updatedAt: string
}

export type EngineType = 'claude-code' | 'codex' | 'acp' | `acp:${string}`

export interface PluginInfo { name: string, path: string }

export interface CategorizedCommands {
  commands: string[]
  agents: string[]
  plugins: PluginInfo[]
}
export type PermissionMode = 'auto' | 'supervised' | 'plan'
export type BusyAction = 'queue' | 'cancel'
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Issue {
  id: string
  projectId: string
  statusId: string
  issueNumber: number
  title: string
  tags: string[] | null
  sortOrder: string
  useWorktree: boolean
  isPinned: boolean
  keepAlive: boolean
  engineType: EngineType | null
  sessionStatus: SessionStatus | null
  prompt: string | null
  externalSessionId: string | null
  model: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: string
  statusUpdatedAt: string
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> = { success: true, data: T } | { success: false, error: string }

export type LogEntryType =
  | 'user-message' |
  'assistant-message' |
  'tool-use' |
  'system-message' |
  'error-message' |
  'thinking' |
  'loading' |
  'token-usage'
export type CommandCategory = 'read' | 'search' | 'edit' | 'fetch' | 'other'

export interface FileChange {
  oldText: string
  newText: string
}

export type ToolAction =
  | { kind: 'file-read', path: string } |
  { kind: 'file-edit', path: string, changes?: FileChange[] } |
  {
    kind: 'command-run'
    command: string
    result?: string
    category?: CommandCategory
  } |
  { kind: 'search', query: string } |
  { kind: 'web-fetch', url: string } |
  { kind: 'tool', toolName: string, arguments?: unknown, result?: unknown } |
  { kind: 'other', description: string }

export interface ToolDetail {
  kind: string
  toolName: string
  toolCallId?: string
  isResult: boolean
  raw?: Record<string, unknown>
}

export interface NormalizedLogEntry {
  messageId?: string
  replyToMessageId?: string
  timestamp?: string
  turnIndex?: number
  entryType: LogEntryType
  content: string
  metadata?: Record<string, unknown>
  toolAction?: ToolAction
  toolDetail?: ToolDetail
}

// ── ChatMessage (rebuilt from NormalizedLogEntry[]) ───────

export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
}

export interface ToolGroupItem {
  /** The tool invocation entry (isResult: false) */
  action: NormalizedLogEntry
  /** The matching tool result entry, if available */
  result: NormalizedLogEntry | null
}

export interface UserChatMessage {
  type: 'user'
  id: string
  entry: NormalizedLogEntry
  attachments: AttachmentMeta[]
  status: 'normal' | 'pending' | 'done' | 'command'
  commandOutput?: NormalizedLogEntry
}

export interface AssistantChatMessage {
  type: 'assistant'
  id: string
  entry: NormalizedLogEntry
  durationMs?: number
}

export interface ToolGroupChatMessage {
  type: 'tool-group'
  id: string
  /** Paired tool call items in this group */
  items: ToolGroupItem[]
  /** Count by tool kind: { 'file-read': 3, 'file-edit': 2, ... } */
  stats: Record<string, number>
  /** Total operations (including hidden) */
  count: number
  /** Number of operations hidden by write filter rules */
  hiddenCount: number
  /** Thinking/description text absorbed from the preceding thinking entry */
  description?: string
}

export interface TaskPlanChatMessage {
  type: 'task-plan'
  id: string
  entry: NormalizedLogEntry
  todos: Array<{ content: string, status: string, activeForm?: string }>
  completedCount: number
}

export interface ThinkingChatMessage {
  type: 'thinking'
  id: string
  entry: NormalizedLogEntry
}

export interface SystemChatMessage {
  type: 'system'
  id: string
  entry: NormalizedLogEntry
  subtype: string
}

export interface ErrorChatMessage {
  type: 'error'
  id: string
  entry: NormalizedLogEntry
}

export type ChatMessage =
  | UserChatMessage |
  AssistantChatMessage |
  ToolGroupChatMessage |
  TaskPlanChatMessage |
  ThinkingChatMessage |
  SystemChatMessage |
  ErrorChatMessage

// ── Tool Progress (lightweight real-time SSE event) ──────

export interface ToolProgressEntry {
  toolName: string
  toolKind: string
  path?: string
  command?: string
}

export interface ToolProgressEvent {
  issueId: string
  executionId: string
  /** Accumulated tool calls in the current group so far */
  items: ToolProgressEntry[]
  stats: Record<string, number>
  count: number
}

export interface ToolGroupEvent {
  issueId: string
  executionId: string
  /** The completed tool group as a ChatMessage */
  message: ToolGroupChatMessage
}

export interface ExecuteIssueRequest {
  engineType: EngineType
  prompt: string
  model?: string
  permissionMode?: PermissionMode
}

export interface ExecuteIssueResponse {
  executionId?: string
  issueId: string
  messageId?: string
  queued?: boolean
}

export interface IssueLogsResponse {
  issue: Issue
  logs: NormalizedLogEntry[]
  hasMore: boolean
  nextCursor: string | null
}

export interface IssueChangedFile {
  path: string
  status: string
  type: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'
  staged: boolean
  unstaged: boolean
  additions?: number
  deletions?: number
}

export interface IssueChangesResponse {
  root: string
  gitRepo: boolean
  files: IssueChangedFile[]
  additions: number
  deletions: number
}

export interface IssueFilePatchResponse {
  path: string
  patch: string
  oldText?: string
  newText?: string
  truncated: boolean
  type?: IssueChangedFile['type']
  status?: string
}

export interface EngineAvailability {
  engineType: EngineType
  installed: boolean
  executable?: boolean
  version?: string
  binaryPath?: string
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown'
  error?: string
}

export interface EngineModel {
  id: string
  name: string
  isDefault?: boolean
}

export interface EngineDiscoveryResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
}

export interface EngineProfile {
  engineType: EngineType
  name: string
  baseCommand: string
  protocol: string
  capabilities: string[]
  defaultModel?: string
  permissionPolicy: string
}

export interface EngineSettings {
  defaultEngine: string | null
  engines: Record<string, { defaultModel?: string, hiddenModels?: string[] }>
}

export interface ProbeResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
  duration: number
}

// ── Event Bus ────────────────────────────────────────────

export interface ChangesSummary {
  issueId: string
  fileCount: number
  additions: number
  deletions: number
}

/** SSE wire format — what the frontend receives via EventSource. */
export interface SSEEventMap {
  'log': { issueId: string, entry: NormalizedLogEntry }
  'log-updated': { issueId: string, entry: NormalizedLogEntry }
  'log-removed': { issueId: string, messageIds: string[] }
  'tool-progress': ToolProgressEvent
  'tool-group': ToolGroupEvent
  'state': { issueId: string, executionId: string, state: string }
  'done': { issueId: string, finalStatus: string }
  'issue-updated': { issueId: string, changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'heartbeat': { ts: string }
}

/** Internal bus format — superset of SSEEventMap, carries engine context. */
export interface AppEventMap {
  'log': {
    issueId: string
    executionId: string
    entry: NormalizedLogEntry
    streaming: boolean
  }
  'log-updated': { issueId: string, entry: NormalizedLogEntry }
  'log-removed': { issueId: string, messageIds: string[] }
  'state': { issueId: string, executionId: string, state: string }
  'done': { issueId: string, executionId: string, finalStatus: string }
  'issue-updated': { issueId: string, changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'heartbeat': { ts: string }
}

// ── File Browser ──────────────────────────────────────────

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

export interface DirectoryListing {
  path: string
  type: 'directory'
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  type: 'file'
  content: string
  size: number
  isTruncated: boolean
  isBinary: boolean
}

export type FileListingResult = DirectoryListing | FileContent

// ── Process Manager ─────────────────────────────────────

export interface ProcessInfo {
  executionId: string
  issueId: string
  issueTitle: string
  issueNumber: number
  projectId: string
  projectAlias: string
  projectName: string
  engineType: string
  processState: string
  model: string | null
  startedAt: string
  turnInFlight: boolean
  spawnCommand: string | null
  lastIdleAt: string | null
  pid: number | null
}

export interface ProjectProcessesResponse {
  processes: ProcessInfo[]
}

// ── Webhooks ─────────────────────────────────────────────

export type WebhookEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'issue.status.todo'
  | 'issue.status.working'
  | 'issue.status.review'
  | 'issue.status.done'
  | 'session.started'
  | 'session.completed'
  | 'session.failed'
  | 'issue.status_changed' // legacy — kept for backwards compat with existing DB records

/** Event types grouped by category for UI display. */
export const WEBHOOK_EVENT_GROUPS: { category: string, events: WebhookEventType[] }[] = [
  {
    category: 'issue',
    events: ['issue.created', 'issue.updated', 'issue.deleted'],
  },
  {
    category: 'status',
    events: ['issue.status.todo', 'issue.status.working', 'issue.status.review', 'issue.status.done'],
  },
  {
    category: 'session',
    events: ['session.started', 'session.completed', 'session.failed'],
  },
]

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  ...WEBHOOK_EVENT_GROUPS.flatMap(g => g.events),
  'issue.status_changed', // legacy compat
]

export type NotificationChannel = 'webhook' | 'telegram'

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['webhook', 'telegram']

export interface Webhook {
  id: string
  channel: NotificationChannel
  url: string
  secret: string | null
  events: WebhookEventType[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  event: WebhookEventType
  payload: string
  statusCode: number | null
  response: string | null
  success: boolean
  duration: number | null
  createdAt: string
}

// ── Notes ───────────────────────────────────────────────

export interface Note {
  id: string
  title: string
  content: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
}
