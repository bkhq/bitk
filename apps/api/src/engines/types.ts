// ---------- Enums / Literal Unions ----------

// Supported AI engine types
export type EngineType = 'claude-code' | 'codex' | 'gemini' | 'echo'

// Communication protocols
export type EngineProtocol = 'stream-json' | 'json-rpc' | 'acp'

// Engine capabilities
export type EngineCapability =
  | 'session-fork'
  | 'setup-helper'
  | 'context-usage'
  | 'plan-mode'
  | 'sandbox'
  | 'reasoning'

// Permission policies
export type PermissionPolicy = 'auto' | 'supervised' | 'plan'

// Session lifecycle status
export type SessionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

// Process lifecycle status
export type ProcessStatus =
  | 'spawning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

// Normalized log entry types
export type LogEntryType =
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'system-message'
  | 'error-message'
  | 'thinking'
  | 'loading'
  | 'token-usage'

// Shell command categories
export type CommandCategory = 'read' | 'search' | 'edit' | 'fetch' | 'other'

// ---------- Interfaces ----------

export interface FileChange {
  oldText: string
  newText: string
}

// Tool action discriminated union
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

// Engine availability (discovery result)
export interface EngineAvailability {
  engineType: EngineType
  installed: boolean
  /** Whether the engine can actually spawn executions. False for stub executors. */
  executable?: boolean
  version?: string
  binaryPath?: string
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown'
  error?: string
}

// Model definition for an engine
export interface EngineModel {
  id: string
  name: string
  description?: string
  isDefault?: boolean
}

// Engine profile configuration
export interface EngineProfile {
  id?: string
  engineType: EngineType
  name: string
  baseCommand: string
  protocol: EngineProtocol
  capabilities: EngineCapability[]
  defaultModel?: string
  permissionPolicy: PermissionPolicy
  config?: Record<string, unknown>
}

// Spawn options for initial execution
export interface SpawnOptions {
  workingDir: string
  prompt: string
  model?: string
  permissionMode?: PermissionPolicy
  env?: Record<string, string>
  agent?: string
  externalSessionId?: string
}

// Follow-up options (extends spawn)
export interface FollowUpOptions extends SpawnOptions {
  sessionId: string
  resetToMessageId?: string
}

// Command builder output
export interface CommandParts {
  program: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

// Resolved command (with full binary path)
export interface ResolvedCommand extends CommandParts {
  resolvedPath: string
}

// We use the Bun Subprocess type
type Subprocess = ReturnType<typeof Bun.spawn>

// Spawned process wrapper
export interface SpawnedProcess {
  subprocess: Subprocess
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  cancel: () => void
  protocolHandler?: {
    interrupt: () => Promise<void>
    close: () => void
    sendUserMessage?: (content: string) => void
  }
  /** Override the caller-provided externalSessionId (used by engines that generate their own session IDs, e.g. Codex thread IDs). */
  externalSessionId?: string
}

// Structured tool detail (persisted in issue_logs_tools_call)
export interface ToolDetail {
  kind: string
  toolName: string
  toolCallId?: string
  isResult: boolean
  raw?: Record<string, unknown> // Full original data for debugging/analysis
}

// Normalized log entry (unified format for all engines)
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

// Executor config (for profile-based resolution)
export interface ExecutorConfig {
  engineType: EngineType
  variant?: string
  modelId?: string
  engineId?: string
  permissionPolicy?: PermissionPolicy
}

// Execution environment
export interface ExecutionEnv {
  vars: Record<string, string>
  workingDir: string
  projectId?: string
  sessionId?: string
  issueId?: string
}

// ---------- Interfaces (Behavioral) ----------

// Engine executor interface (one per engine type)
export interface EngineExecutor {
  readonly engineType: EngineType
  readonly protocol: EngineProtocol
  readonly capabilities: EngineCapability[]

  spawn: (options: SpawnOptions, env: ExecutionEnv) => Promise<SpawnedProcess>
  spawnFollowUp: (
    options: FollowUpOptions,
    env: ExecutionEnv,
  ) => Promise<SpawnedProcess>
  cancel: (process: SpawnedProcess) => Promise<void>
  getAvailability: () => Promise<EngineAvailability>
  getModels: () => Promise<EngineModel[]>
  normalizeLog: (
    rawLine: string,
  ) => NormalizedLogEntry | NormalizedLogEntry[] | null

  createNormalizer?: (
    filterRules: import('./write-filter').WriteFilterRule[],
  ) => {
    parse: (rawLine: string) => NormalizedLogEntry | NormalizedLogEntry[] | null
  }
}

// Engine registry (manages all executors)
export interface EngineRegistry {
  register: (executor: EngineExecutor) => void
  get: (engineType: EngineType) => EngineExecutor | undefined
  getAll: () => EngineExecutor[]
  getAvailable: () => Promise<EngineAvailability[]>
  getModels: (engineType: EngineType) => Promise<EngineModel[]>
}

// ---------- Constants ----------

// Default built-in engine profiles
export const BUILT_IN_PROFILES: Record<EngineType, EngineProfile> = {
  'claude-code': {
    engineType: 'claude-code',
    name: 'Claude Code',
    baseCommand: 'npx -y @anthropic-ai/claude-code@latest',
    protocol: 'stream-json',
    capabilities: ['session-fork', 'context-usage', 'plan-mode'],
    permissionPolicy: 'auto',
  },
  codex: {
    engineType: 'codex',
    name: 'Codex',
    baseCommand: 'npx -y @openai/codex@latest app-server',
    protocol: 'json-rpc',
    capabilities: [
      'session-fork',
      'setup-helper',
      'context-usage',
      'sandbox',
      'reasoning',
    ],
    permissionPolicy: 'auto',
  },
  gemini: {
    engineType: 'gemini',
    name: 'Gemini CLI',
    baseCommand: 'npx -y @google/gemini-cli@latest',
    protocol: 'acp',
    capabilities: ['session-fork'],
    permissionPolicy: 'auto',
  },
  echo: {
    engineType: 'echo',
    name: 'Echo',
    baseCommand: 'echo',
    protocol: 'stream-json',
    capabilities: ['session-fork'],
    permissionPolicy: 'auto',
  },
}
