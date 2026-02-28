// @bitk/shared — Types shared between @bitk/api and @bitk/frontend
// Re-exported from packages/shared for cross-workspace consumption.

export type Priority = 'urgent' | 'high' | 'medium' | 'low'

export type Project = {
  id: string
  alias: string
  name: string
  description?: string
  directory?: string
  repositoryUrl?: string
  createdAt: string
  updatedAt: string
}

export type EngineType = 'claude-code' | 'codex' | 'gemini' | 'echo'
export type PermissionMode = 'auto' | 'supervised' | 'plan'
export type BusyAction = 'queue' | 'cancel'
export type SessionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type Issue = {
  id: string
  projectId: string
  statusId: string
  issueNumber: number
  title: string
  priority: Priority
  sortOrder: number
  parentIssueId: string | null
  useWorktree: boolean
  childCount?: number
  children?: Issue[]
  engineType: EngineType | null
  sessionStatus: SessionStatus | null
  prompt: string | null
  externalSessionId: string | null
  model: string | null
  devMode: boolean
  baseCommitHash: string | null
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type LogEntryType =
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'system-message'
  | 'error-message'
  | 'thinking'
  | 'loading'
  | 'token-usage'
export type CommandCategory = 'read' | 'search' | 'edit' | 'fetch' | 'other'

export interface FileChange {
  oldText: string
  newText: string
}

export type ToolAction =
  | { kind: 'file-read'; path: string }
  | { kind: 'file-edit'; path: string; changes?: FileChange[] }
  | {
      kind: 'command-run'
      command: string
      result?: string
      category?: CommandCategory
    }
  | { kind: 'search'; query: string }
  | { kind: 'web-fetch'; url: string }
  | { kind: 'tool'; toolName: string; arguments?: unknown; result?: unknown }
  | { kind: 'other'; description: string }

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
  engines: Record<string, { defaultModel?: string }>
}

export interface ProbeResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
  duration: number
}
