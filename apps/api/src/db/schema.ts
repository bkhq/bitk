import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { customAlphabet } from 'nanoid'
import { ulid } from 'ulid'

const readableId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

export function shortId() {
  return text('id')
    .primaryKey()
    .$defaultFn(() => readableId())
}

export function id() {
  return text('id')
    .primaryKey()
    .$defaultFn(() => ulid())
}

export const commonFields = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  isDeleted: integer('is_deleted').notNull().default(0),
}

export const projects = sqliteTable('projects', {
  id: shortId(),
  name: text('name').notNull(),
  alias: text('alias').notNull().unique(),
  description: text('description'),
  directory: text('directory'),
  repositoryUrl: text('repository_url'),
  systemPrompt: text('system_prompt'),
  envVars: text('env_vars'), // JSON: Record<string, string>
  sortOrder: text('sort_order').notNull().default('a0'),
  isArchived: integer('is_archived').notNull().default(0),
  ...commonFields,
})

export const issues = sqliteTable(
  'issues',
  {
    id: shortId(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    statusId: text('status_id').notNull(),
    issueNumber: integer('issue_number').notNull(),
    title: text('title').notNull(),
    tag: text('tag'),
    sortOrder: text('sort_order').notNull().default('a0'),
    parentIssueId: text('parent_issue_id').references((): any => issues.id),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(false),
    // Session fields (null = no engine session started)
    engineType: text('engine_type'),
    sessionStatus: text('session_status'),
    prompt: text('prompt'),
    externalSessionId: text('external_session_id'),

    model: text('model'),
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    totalCostUsd: text('total_cost_usd').notNull().default('0'),
    statusUpdatedAt: integer('status_updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`0`)
      .$defaultFn(() => new Date()),
    ...commonFields,
  },
  table => [
    index('issues_project_id_idx').on(table.projectId),
    index('issues_status_id_idx').on(table.statusId),
    index('issues_parent_issue_id_idx').on(table.parentIssueId),
    index('issues_project_id_status_updated_at_idx').on(table.projectId, table.statusUpdatedAt),
    check('issues_status_id_check', sql`${table.statusId} IN ('todo','working','review','done')`),
    uniqueIndex('issues_project_id_issue_number_uniq').on(table.projectId, table.issueNumber),
  ],
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...commonFields,
})

export const notes = sqliteTable('notes', {
  id: id(),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  ...commonFields,
})

export const issueLogs = sqliteTable(
  'issues_logs',
  {
    id: id(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issues.id),
    turnIndex: integer('turn_index').notNull().default(0),
    entryIndex: integer('entry_index').notNull(),
    entryType: text('entry_type').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata'),
    replyToMessageId: text('reply_to_message_id'),
    timestamp: text('timestamp'),
    toolCallRefId: text('tool_call_ref_id'), // FK to issue_logs_tools_call.id (app-level, no DB FK to avoid circular ref)
    visible: integer('visible').notNull().default(1),
    ...commonFields,
  },
  table => [
    index('issues_logs_issue_id_idx').on(table.issueId),
    index('issues_logs_issue_id_turn_entry_idx').on(
      table.issueId,
      table.turnIndex,
      table.entryIndex,
    ),
    index('issues_logs_issue_id_visible_type_idx').on(
      table.issueId,
      table.visible,
      table.entryType,
    ),
  ],
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: id(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issues.id),
    logId: text('log_id').references(() => issueLogs.id),
    originalName: text('original_name').notNull(),
    storedName: text('stored_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    storagePath: text('storage_path').notNull(),
    ...commonFields,
  },
  table => [
    index('attachments_issue_id_idx').on(table.issueId),
    index('attachments_log_id_idx').on(table.logId),
  ],
)

export const webhooks = sqliteTable('webhooks', {
  id: id(),
  channel: text('channel').notNull().default('webhook'), // 'webhook' | 'telegram'
  url: text('url').notNull(), // webhook: URL, telegram: chat ID
  secret: text('secret'), // webhook: API key, telegram: bot token
  events: text('events').notNull(), // JSON: WebhookEventType[]
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...commonFields,
})

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: id(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id),
    event: text('event').notNull(),
    dedupKey: text('dedup_key'), // e.g. "issue.status.review:issueId" — for skipping duplicates
    payload: text('payload').notNull(),
    statusCode: integer('status_code'),
    response: text('response'),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    duration: integer('duration'), // ms
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    index('webhook_deliveries_webhook_id_idx').on(table.webhookId),
    index('webhook_deliveries_created_at_idx').on(table.createdAt),
    index('webhook_deliveries_dedup_idx').on(table.webhookId, table.dedupKey, table.createdAt),
  ],
)

export const issuesLogsToolsCall = sqliteTable(
  'issues_logs_tools_call',
  {
    id: id(),
    logId: text('log_id')
      .notNull()
      .references(() => issueLogs.id),
    issueId: text('issue_id')
      .notNull()
      .references(() => issues.id),
    toolName: text('tool_name').notNull(),
    toolCallId: text('tool_call_id'),
    kind: text('kind').notNull(), // file-read | file-edit | command-run | search | web-fetch | task | tool | other
    isResult: integer('is_result', { mode: 'boolean' }).notNull().default(false),
    raw: text('raw'), // Full original JSON (entry metadata + input + result, for future analysis)
    ...commonFields,
  },
  table => [
    index('issues_logs_tools_call_log_id_idx').on(table.logId),
    index('issues_logs_tools_call_issue_id_idx').on(table.issueId),
    index('issues_logs_tools_call_kind_idx').on(table.kind),
    index('issues_logs_tools_call_tool_name_idx').on(table.toolName),
    index('issues_logs_tools_call_issue_id_kind_idx').on(table.issueId, table.kind),
  ],
)
