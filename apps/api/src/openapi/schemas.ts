/**
 * Shared Zod schemas with OpenAPI metadata.
 *
 * These schemas serve dual purpose:
 * 1. Runtime validation via @hono/zod-validator
 * 2. OpenAPI spec generation via @hono/zod-openapi
 *
 * Convention: every schema that appears in the generated spec
 * must call `.openapi('SchemaName')` so it gets a $ref.
 */
import * as z from 'zod'

// ── Common helpers ─────────────────────────────────────

/** Standard success envelope wrapping any data schema */
export function successResponse(dataSchema: z.ZodType, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: z.object({
          success: z.literal(true),
          data: dataSchema,
        }),
      },
    },
  } as const
}

/** Standard error envelope (reused across all error responses) */
export const errorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
}).openapi('ErrorResponse')

export function errorResponse(description: string, statusCode?: number) {
  return {
    description: description || `Error (${statusCode})`,
    content: {
      'application/json': {
        schema: errorSchema,
      },
    },
  } as const
}

/** Common path parameter: projectId */
export const projectIdParam = {
  in: 'path' as const,
  name: 'projectId',
  required: true as const,
  schema: z.string().openapi({ description: 'Project ID or alias' }),
}

/** Common path parameter: issueId */
export const issueIdParam = {
  in: 'path' as const,
  name: 'issueId',
  required: true as const,
  schema: z.string().openapi({ description: 'Issue ID' }),
}

// ── Project schemas ────────────────────────────────────

const envVarsSchema = z.record(z.string(), z.string().max(10000)).optional()

export const ProjectSchema = z.object({
  id: z.string(),
  alias: z.string(),
  name: z.string(),
  description: z.string().optional(),
  directory: z.string().optional(),
  repositoryUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  sortOrder: z.string(),
  isArchived: z.boolean(),
  isGitRepo: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('Project')

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  alias: z.string().min(1).max(200).regex(/^[a-z0-9]+$/).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  systemPrompt: z.string().max(32768).optional(),
  envVars: envVarsSchema,
}).openapi('CreateProject')

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  alias: z.string().min(1).max(200).regex(/^[a-z0-9]+$/).optional(),
  description: z.string().max(5000).optional(),
  directory: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  systemPrompt: z.string().max(32768).optional(),
  envVars: envVarsSchema,
  sortOrder: z.string().min(1).max(50).regex(/^[a-z0-9]+$/i).optional(),
}).openapi('UpdateProject')

export const SortProjectSchema = z.object({
  id: z.string(),
  sortOrder: z.string().min(1).max(50).regex(/^[a-z0-9]+$/i),
}).openapi('SortProject')

// ── Issue schemas ──────────────────────────────────────

const statusIdEnum = z.enum(['todo', 'working', 'review', 'done'])

export const IssueSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  statusId: statusIdEnum,
  issueNumber: z.number().int(),
  title: z.string(),
  tags: z.array(z.string()).nullable(),
  sortOrder: z.string(),
  useWorktree: z.boolean(),
  isPinned: z.boolean(),
  keepAlive: z.boolean(),
  engineType: z.string().nullable(),
  sessionStatus: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).nullable(),
  prompt: z.string().nullable(),
  externalSessionId: z.string().nullable(),
  model: z.string().nullable(),
  statusUpdatedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('Issue')

export const CreateIssueSchema = z.object({
  title: z.string().min(1).max(500),
  tags: z.array(z.string().max(50)).max(10).optional(),
  statusId: statusIdEnum,
  useWorktree: z.boolean().optional(),
  keepAlive: z.boolean().optional(),
  engineType: z.string().regex(/^(claude-code|codex|acp(:.+)?)$/).optional().openapi({ description: 'claude-code | codex | acp | acp:<agent>:<model>' }),
  model: z.string().regex(/^[\w./:\-[\]]{1,160}$/).optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
}).openapi('CreateIssue')

export const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).nullable().optional(),
  statusId: statusIdEnum.optional(),
  sortOrder: z.string().min(1).max(50).regex(/^[a-z0-9]+$/i).optional(),
  isPinned: z.boolean().optional(),
  keepAlive: z.boolean().optional(),
}).openapi('UpdateIssue')

export const BulkUpdateSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    statusId: statusIdEnum.optional(),
    sortOrder: z.string().min(1).max(50).regex(/^[a-z0-9]+$/i).optional(),
  })).max(1000).superRefine((updates, ctx) => {
    const seen = new Set<string>()
    for (const [index, update] of updates.entries()) {
      if (seen.has(update.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate issue id in bulk updates',
          path: [index, 'id'],
        })
        continue
      }
      seen.add(update.id)
    }
  }),
}).openapi('BulkUpdate')

export const ExecuteIssueSchema = z.object({
  engineType: z.string().regex(/^(claude-code|codex|acp(:.+)?)$/).openapi({ description: 'claude-code | codex | acp | acp:<agent>:<model>' }),
  prompt: z.string().min(1).max(32768),
  model: z.string().regex(/^[\w./:\-[\]]{1,160}$/).optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
}).openapi('ExecuteIssue')

export const FollowUpSchema = z.object({
  prompt: z.string().min(1).max(32768),
  model: z.string().regex(/^[\w./:\-[\]]{1,160}$/).optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
  busyAction: z.enum(['queue', 'cancel']).optional(),
  meta: z.boolean().optional(),
  displayPrompt: z.string().max(500).optional(),
}).openapi('FollowUp')

export const ExecuteIssueResponseSchema = z.object({
  executionId: z.string().optional(),
  issueId: z.string(),
  messageId: z.string().optional(),
  queued: z.boolean().optional(),
}).openapi('ExecuteIssueResponse')

// ── Log schemas ────────────────────────────────────────

export const NormalizedLogEntrySchema = z.object({
  messageId: z.string().optional(),
  replyToMessageId: z.string().optional(),
  timestamp: z.string().optional(),
  turnIndex: z.number().int().optional(),
  entryType: z.enum([
    'user-message',
    'assistant-message',
    'tool-use',
    'system-message',
    'error-message',
    'thinking',
    'loading',
    'token-usage',
  ]),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  toolAction: z.record(z.string(), z.unknown()).optional(),
  toolDetail: z.record(z.string(), z.unknown()).optional(),
}).openapi('NormalizedLogEntry')

export const IssueLogsResponseSchema = z.object({
  issue: IssueSchema,
  logs: z.array(NormalizedLogEntrySchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
}).openapi('IssueLogsResponse')

export const IssueChangedFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  type: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'unknown']),
  staged: z.boolean(),
  unstaged: z.boolean(),
  additions: z.number().int().optional(),
  deletions: z.number().int().optional(),
  oversized: z.boolean().optional(),
  sizeDisplay: z.string().optional(),
}).openapi('IssueChangedFile')

export const IssueChangesResponseSchema = z.object({
  root: z.string(),
  gitRepo: z.boolean(),
  files: z.array(IssueChangedFileSchema),
  additions: z.number().int(),
  deletions: z.number().int(),
  timedOut: z.boolean().optional(),
}).openapi('IssueChangesResponse')

// ── Engine schemas ─────────────────────────────────────

export const EngineAvailabilitySchema = z.object({
  engineType: z.string(),
  installed: z.boolean(),
  executable: z.boolean().optional(),
  version: z.string().optional(),
  binaryPath: z.string().optional(),
  authStatus: z.enum(['authenticated', 'unauthenticated', 'unknown']),
  error: z.string().optional(),
}).openapi('EngineAvailability')

export const EngineModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean().optional(),
}).openapi('EngineModel')

export const EngineDiscoveryResultSchema = z.object({
  engines: z.array(EngineAvailabilitySchema),
  models: z.record(z.string(), z.array(EngineModelSchema)),
}).openapi('EngineDiscoveryResult')

export const EngineProfileSchema = z.object({
  engineType: z.string(),
  name: z.string(),
  baseCommand: z.string(),
  protocol: z.string(),
  capabilities: z.array(z.string()),
  defaultModel: z.string().optional(),
  permissionPolicy: z.string(),
}).openapi('EngineProfile')

export const EngineSettingsSchema = z.object({
  defaultEngine: z.string().nullable(),
  engines: z.record(z.string(), z.object({
    defaultModel: z.string().optional(),
    hiddenModels: z.array(z.string()).optional(),
  })),
}).openapi('EngineSettings')

export const ProbeResultSchema = z.object({
  engines: z.array(EngineAvailabilitySchema),
  models: z.record(z.string(), z.array(EngineModelSchema)),
  duration: z.number(),
}).openapi('ProbeResult')

// ── Cron schemas ───────────────────────────────────────

export const CronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  taskType: z.string(),
  taskConfig: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  lastRun: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('CronJob')

export const CreateCronJobSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1),
  action: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
}).openapi('CreateCronJob')

// ── Process schemas ────────────────────────────────────

export const ProcessInfoSchema = z.object({
  executionId: z.string(),
  issueId: z.string(),
  issueTitle: z.string(),
  issueNumber: z.number().int(),
  projectId: z.string(),
  projectAlias: z.string(),
  projectName: z.string(),
  engineType: z.string(),
  processState: z.string(),
  model: z.string().nullable(),
  startedAt: z.string(),
  turnInFlight: z.boolean(),
  spawnCommand: z.string().nullable(),
  lastIdleAt: z.string().nullable(),
  pid: z.number().int().nullable(),
}).openapi('ProcessInfo')

// ── Note schemas ───────────────────────────────────────

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  isPinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('Note')

export const CreateNoteSchema = z.object({
  title: z.string().max(500).optional().default(''),
  content: z.string().max(100_000).optional().default(''),
}).openapi('CreateNote')

export const UpdateNoteSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().max(100_000).optional(),
  isPinned: z.boolean().optional(),
}).openapi('UpdateNote')

// ── Worktree schemas ───────────────────────────────────

export const WorktreeEntrySchema = z.object({
  issueId: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
}).openapi('WorktreeEntry')

// ── Webhook schemas ────────────────────────────────────

const webhookEventTypes = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.status.todo',
  'issue.status.working',
  'issue.status.review',
  'issue.status.done',
  'session.started',
  'session.completed',
  'session.failed',
] as const

export const WebhookSchema = z.object({
  id: z.string(),
  channel: z.enum(['webhook', 'telegram']),
  url: z.string(),
  secret: z.string().nullable().openapi({ description: 'Masked in responses' }),
  events: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('Webhook')

export const CreateWebhookSchema = z.object({
  channel: z.enum(['webhook', 'telegram']).optional().default('webhook'),
  url: z.string().min(1).openapi({ description: 'Webhook URL or Telegram chat ID' }),
  secret: z.string().max(256).optional().openapi({ description: 'HMAC secret or Telegram bot token' }),
  events: z.array(z.enum(webhookEventTypes)).min(1),
  isActive: z.boolean().optional(),
}).openapi('CreateWebhook')

export const UpdateWebhookSchema = z.object({
  url: z.string().min(1).optional(),
  secret: z.string().max(256).nullable().optional(),
  events: z.array(z.enum(webhookEventTypes)).min(1).optional(),
  isActive: z.boolean().optional(),
}).openapi('UpdateWebhook')

export const WebhookDeliverySchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  event: z.string(),
  payload: z.string(),
  statusCode: z.number().int().nullable(),
  response: z.string().nullable(),
  success: z.boolean(),
  duration: z.number().int().nullable(),
  createdAt: z.string(),
}).openapi('WebhookDelivery')

// ── Settings schemas ───────────────────────────────────

export const WriteFilterRuleSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('tool-name'),
  match: z.string().min(1).max(128),
  enabled: z.boolean(),
}).openapi('WriteFilterRule')

export const CategorizedCommandsSchema = z.object({
  commands: z.array(z.string()),
  agents: z.array(z.string()),
  plugins: z.array(z.object({
    name: z.string(),
    path: z.string(),
  })),
}).openapi('CategorizedCommands')
