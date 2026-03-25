/**
 * OpenAPI route definitions using @hono/zod-openapi createRoute.
 *
 * These are pure route metadata — no handler logic.
 * Each route file imports the relevant definition and calls app.openapi(route, handler).
 */
import { createRoute } from '@hono/zod-openapi'
import * as z from 'zod'
import {
  BulkUpdateSchema,
  CategorizedCommandsSchema,
  CreateCronJobSchema,
  CreateIssueSchema,
  CreateNoteSchema,
  CreateProjectSchema,
  CreateWebhookSchema,
  CronJobSchema,
  EngineDiscoveryResultSchema,
  EngineModelSchema,
  EngineProfileSchema,
  EngineSettingsSchema,
  errorResponse,
  ExecuteIssueResponseSchema,
  ExecuteIssueSchema,
  FollowUpSchema,
  IssueChangesResponseSchema,
  IssueLogsResponseSchema,
  IssueSchema,
  NoteSchema,
  ProbeResultSchema,
  ProcessCapacitySchema,
  ProcessInfoSchema,
  ProjectSchema,
  SortProjectSchema,
  successResponse,
  UpdateIssueSchema,
  UpdateNoteSchema,
  UpdateProjectSchema,
  UpdateWebhookSchema,
  WebhookDeliverySchema,
  WebhookSchema,
  WorktreeEntrySchema,
  WriteFilterRuleSchema,
} from './schemas'

// ── Meta ───────────────────────────────────────────────

export const getApiRoot = createRoute({
  method: 'get',
  path: '/',
  tags: ['Meta'],
  summary: 'API root',
  operationId: 'getApiRoot',
  responses: {
    200: successResponse(z.object({
      name: z.string(),
      status: z.string(),
      routes: z.array(z.string()),
    }), 'API info'),
  },
})

export const getHealth = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Meta'],
  summary: 'Health check',
  operationId: 'getHealth',
  responses: {
    200: successResponse(z.object({
      status: z.string(),
      version: z.string(),
      commit: z.string(),
      db: z.string(),
      timestamp: z.string(),
    }), 'Health status'),
  },
})

export const getStatus = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Meta'],
  summary: 'Detailed server status',
  operationId: 'getStatus',
  responses: {
    200: successResponse(z.object({
      uptime: z.number(),
      memory: z.object({
        rss: z.number().int(),
        heapUsed: z.number().int(),
        heapTotal: z.number().int(),
      }),
      db: z.object({
        ok: z.boolean(),
        error: z.string().optional(),
      }),
    }), 'Server status'),
  },
})

// ── Projects ───────────────────────────────────────────

export const listProjects = createRoute({
  method: 'get',
  path: '/',
  tags: ['Projects'],
  summary: 'List projects',
  operationId: 'listProjects',
  request: {
    query: z.object({
      archived: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: successResponse(z.array(ProjectSchema), 'Project list'),
  },
})

export const createProject = createRoute({
  method: 'post',
  path: '/',
  tags: ['Projects'],
  summary: 'Create project',
  operationId: 'createProject',
  request: { body: { content: { 'application/json': { schema: CreateProjectSchema } } } },
  responses: {
    201: successResponse(ProjectSchema, 'Created project'),
    400: errorResponse('Validation error'),
    409: errorResponse('Directory already in use'),
  },
})

export const sortProject = createRoute({
  method: 'patch',
  path: '/sort',
  tags: ['Projects'],
  summary: 'Reorder a project',
  operationId: 'sortProject',
  request: { body: { content: { 'application/json': { schema: SortProjectSchema } } } },
  responses: {
    200: successResponse(z.null(), 'Success'),
    404: errorResponse('Project not found'),
  },
})

export const getProject = createRoute({
  method: 'get',
  path: '/{projectId}',
  tags: ['Projects'],
  summary: 'Get project',
  operationId: 'getProject',
  request: { params: z.object({ projectId: z.string() }) },
  responses: {
    200: successResponse(ProjectSchema, 'Project'),
    404: errorResponse('Project not found'),
  },
})

export const updateProject = createRoute({
  method: 'patch',
  path: '/{projectId}',
  tags: ['Projects'],
  summary: 'Update project',
  operationId: 'updateProject',
  request: {
    params: z.object({ projectId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateProjectSchema } } },
  },
  responses: {
    200: successResponse(ProjectSchema, 'Updated project'),
    404: errorResponse('Project not found'),
    409: errorResponse('Directory already in use'),
  },
})

export const deleteProject = createRoute({
  method: 'delete',
  path: '/{projectId}',
  tags: ['Projects'],
  summary: 'Soft-delete project',
  operationId: 'deleteProject',
  request: { params: z.object({ projectId: z.string() }) },
  responses: {
    200: successResponse(z.object({ id: z.string() }), 'Deleted'),
    404: errorResponse('Project not found'),
  },
})

export const archiveProject = createRoute({
  method: 'post',
  path: '/{projectId}/archive',
  tags: ['Projects'],
  summary: 'Archive project',
  operationId: 'archiveProject',
  request: { params: z.object({ projectId: z.string() }) },
  responses: {
    200: successResponse(ProjectSchema, 'Archived project'),
    404: errorResponse('Project not found'),
  },
})

export const unarchiveProject = createRoute({
  method: 'post',
  path: '/{projectId}/unarchive',
  tags: ['Projects'],
  summary: 'Unarchive project',
  operationId: 'unarchiveProject',
  request: { params: z.object({ projectId: z.string() }) },
  responses: {
    200: successResponse(ProjectSchema, 'Unarchived project'),
    404: errorResponse('Project not found'),
  },
})

// ── Issues ─────────────────────────────────────────────

const projectParam = z.object({ projectId: z.string() })
const projectIssueParams = z.object({ projectId: z.string(), issueId: z.string() })

export const listIssues = createRoute({
  method: 'get',
  path: '/',
  tags: ['Issues'],
  summary: 'List issues in project',
  operationId: 'listIssues',
  request: { params: projectParam },
  responses: {
    200: successResponse(z.array(IssueSchema), 'Issue list'),
    404: errorResponse('Project not found'),
  },
})

export const createIssue = createRoute({
  method: 'post',
  path: '/',
  tags: ['Issues'],
  summary: 'Create issue',
  operationId: 'createIssue',
  request: {
    params: projectParam,
    body: { content: { 'application/json': { schema: CreateIssueSchema } } },
  },
  responses: {
    201: successResponse(IssueSchema, 'Created issue'),
    202: successResponse(IssueSchema, 'Created and executing'),
    400: errorResponse('Validation error'),
    404: errorResponse('Project not found'),
  },
})

export const getIssue = createRoute({
  method: 'get',
  path: '/{issueId}',
  tags: ['Issues'],
  summary: 'Get issue',
  operationId: 'getIssue',
  request: { params: projectIssueParams },
  responses: {
    200: successResponse(IssueSchema, 'Issue'),
    404: errorResponse('Issue not found'),
  },
})

export const updateIssue = createRoute({
  method: 'patch',
  path: '/{issueId}',
  tags: ['Issues'],
  summary: 'Update issue',
  operationId: 'updateIssue',
  request: {
    params: projectIssueParams,
    body: { content: { 'application/json': { schema: UpdateIssueSchema } } },
  },
  responses: {
    200: successResponse(IssueSchema, 'Updated issue'),
    404: errorResponse('Issue not found'),
  },
})

export const deleteIssue = createRoute({
  method: 'delete',
  path: '/{issueId}',
  tags: ['Issues'],
  summary: 'Soft-delete issue',
  operationId: 'deleteIssue',
  request: { params: projectIssueParams },
  responses: {
    200: successResponse(z.object({ id: z.string() }), 'Deleted'),
    404: errorResponse('Issue not found'),
  },
})

export const bulkUpdateIssues = createRoute({
  method: 'patch',
  path: '/bulk',
  tags: ['Issues'],
  summary: 'Bulk update issues',
  operationId: 'bulkUpdateIssues',
  request: {
    params: projectParam,
    body: { content: { 'application/json': { schema: BulkUpdateSchema } } },
  },
  responses: {
    200: successResponse(z.array(IssueSchema), 'Updated issues'),
    404: errorResponse('Project not found'),
  },
})

export const duplicateIssue = createRoute({
  method: 'post',
  path: '/{issueId}/duplicate',
  tags: ['Issues'],
  summary: 'Duplicate issue',
  operationId: 'duplicateIssue',
  request: { params: projectIssueParams },
  responses: {
    201: successResponse(IssueSchema, 'Duplicated issue'),
    404: errorResponse('Issue not found'),
    500: errorResponse('Internal error'),
  },
})

// ── Issue Commands ─────────────────────────────────────

export const executeIssue = createRoute({
  method: 'post',
  path: '/{issueId}/execute',
  tags: ['Issue Commands'],
  summary: 'Start AI execution on issue',
  operationId: 'executeIssue',
  request: {
    params: projectIssueParams,
    body: { content: { 'application/json': { schema: ExecuteIssueSchema } } },
  },
  responses: {
    200: successResponse(ExecuteIssueResponseSchema, 'Execution started'),
    400: errorResponse('Bad request'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Issue not found'),
  },
})

// Note: followUpIssue accepts both JSON and multipart/form-data (file uploads).
// It uses message.post() instead of message.openapi() because OpenAPIHono's
// automatic body validation doesn't support dual content-type parsing.
// This definition exists for documentation; the handler validates manually.
export const followUpIssue = createRoute({
  method: 'post',
  path: '/{issueId}/follow-up',
  tags: ['Issue Commands'],
  summary: 'Send follow-up message (JSON or multipart/form-data with file attachments)',
  operationId: 'followUpIssue',
  request: {
    params: projectIssueParams,
    body: { content: { 'application/json': { schema: FollowUpSchema } } },
  },
  responses: {
    200: successResponse(ExecuteIssueResponseSchema, 'Follow-up sent'),
    400: errorResponse('Bad request'),
    404: errorResponse('Issue not found'),
  },
})

export const restartIssue = createRoute({
  method: 'post',
  path: '/{issueId}/restart',
  tags: ['Issue Commands'],
  summary: 'Restart failed session',
  operationId: 'restartIssue',
  request: { params: projectIssueParams },
  responses: {
    200: successResponse(ExecuteIssueResponseSchema, 'Restarted'),
    400: errorResponse('Bad request'),
    404: errorResponse('Issue not found'),
  },
})

export const cancelIssue = createRoute({
  method: 'post',
  path: '/{issueId}/cancel',
  tags: ['Issue Commands'],
  summary: 'Cancel active session',
  operationId: 'cancelIssue',
  request: { params: projectIssueParams },
  responses: {
    200: successResponse(z.object({ issueId: z.string(), status: z.string() }), 'Cancelled'),
    400: errorResponse('Cancel failed'),
    404: errorResponse('Issue not found'),
  },
})

export const getSlashCommands = createRoute({
  method: 'get',
  path: '/{issueId}/slash-commands',
  tags: ['Issue Commands'],
  summary: 'List available slash commands',
  operationId: 'getSlashCommands',
  request: { params: projectIssueParams },
  responses: {
    200: successResponse(CategorizedCommandsSchema, 'Slash commands'),
    404: errorResponse('Issue not found'),
  },
})

// ── Issue Logs ─────────────────────────────────────────

export const getIssueLogs = createRoute({
  method: 'get',
  path: '/{issueId}/logs',
  tags: ['Issue Logs'],
  summary: 'Get issue logs (paginated)',
  operationId: 'getIssueLogs',
  request: {
    params: projectIssueParams,
    query: z.object({
      cursor: z.string().optional(),
      before: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: successResponse(IssueLogsResponseSchema, 'Issue logs'),
    404: errorResponse('Issue not found'),
  },
})

export const getIssueChanges = createRoute({
  method: 'get',
  path: '/{issueId}/changes',
  tags: ['Issue Logs'],
  summary: 'Get file changes for issue',
  operationId: 'getIssueChanges',
  request: {
    params: projectIssueParams,
    query: z.object({ path: z.string().optional() }),
  },
  responses: {
    200: successResponse(IssueChangesResponseSchema, 'File changes'),
    400: errorResponse('Bad request'),
    404: errorResponse('Issue not found'),
  },
})

// ── Engines ────────────────────────────────────────────

export const getAvailableEngines = createRoute({
  method: 'get',
  path: '/available',
  tags: ['Engines'],
  summary: 'List detected engines and their models',
  operationId: 'getAvailableEngines',
  responses: {
    200: successResponse(EngineDiscoveryResultSchema, 'Engine discovery result'),
  },
})

export const getEngineProfiles = createRoute({
  method: 'get',
  path: '/profiles',
  tags: ['Engines'],
  summary: 'List engine profiles',
  operationId: 'getEngineProfiles',
  responses: {
    200: successResponse(z.array(EngineProfileSchema), 'Engine profiles'),
  },
})

export const getEngineSettings = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Engines'],
  summary: 'Get engine settings',
  operationId: 'getEngineSettings',
  responses: {
    200: successResponse(EngineSettingsSchema, 'Engine settings'),
  },
})

export const setDefaultEngine = createRoute({
  method: 'patch',
  path: '/default-engine',
  tags: ['Engines'],
  summary: 'Set default engine',
  operationId: 'setDefaultEngine',
  request: {
    body: { content: { 'application/json': { schema: z.object({ defaultEngine: z.string() }) } } },
  },
  responses: {
    200: successResponse(z.object({ defaultEngine: z.string() }), 'Updated'),
    400: errorResponse('Invalid engine type'),
  },
})

export const setEngineModel = createRoute({
  method: 'patch',
  path: '/{engineType}/settings',
  tags: ['Engines'],
  summary: 'Set default model for engine',
  operationId: 'setEngineModel',
  request: {
    params: z.object({ engineType: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ defaultModel: z.string().min(1) }) } } },
  },
  responses: {
    200: successResponse(z.object({ engineType: z.string(), defaultModel: z.string() }), 'Updated'),
    400: errorResponse('Invalid engine type'),
  },
})

export const setHiddenModels = createRoute({
  method: 'patch',
  path: '/{engineType}/hidden-models',
  tags: ['Engines'],
  summary: 'Update hidden models for engine',
  operationId: 'setHiddenModels',
  request: {
    params: z.object({ engineType: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ hiddenModels: z.array(z.string()).max(500) }) } } },
  },
  responses: {
    200: successResponse(z.object({ engineType: z.string(), hiddenModels: z.array(z.string()) }), 'Updated'),
    400: errorResponse('Invalid engine type'),
  },
})

export const getEngineModels = createRoute({
  method: 'get',
  path: '/{engineType}/models',
  tags: ['Engines'],
  summary: 'List available models for an engine',
  operationId: 'getEngineModels',
  request: { params: z.object({ engineType: z.string() }) },
  responses: {
    200: successResponse(z.object({
      engineType: z.string(),
      defaultModel: z.string().optional(),
      models: z.array(EngineModelSchema),
    }), 'Models'),
    400: errorResponse('Invalid engine type'),
    404: errorResponse('Engine not found'),
  },
})

export const probeEngines = createRoute({
  method: 'post',
  path: '/probe',
  tags: ['Engines'],
  summary: 'Force live re-probe of all engines',
  operationId: 'probeEngines',
  responses: {
    200: successResponse(ProbeResultSchema, 'Probe result'),
  },
})

// ── Cron ───────────────────────────────────────────────

export const listCronJobs = createRoute({
  method: 'get',
  path: '/',
  tags: ['Cron'],
  summary: 'List cron jobs',
  operationId: 'listCronJobs',
  request: {
    query: z.object({
      deleted: z.enum(['true', 'false', 'only']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: successResponse(z.union([
      z.array(CronJobSchema),
      z.object({ jobs: z.array(CronJobSchema), hasMore: z.boolean(), nextCursor: z.string().nullable() }),
    ]), 'Cron jobs'),
  },
})

export const listCronActions = createRoute({
  method: 'get',
  path: '/actions',
  tags: ['Cron'],
  summary: 'List available cron actions',
  operationId: 'listCronActions',
  responses: {
    200: successResponse(z.object({ help: z.record(z.string(), z.unknown()) }), 'Action list'),
  },
})

export const createCronJob = createRoute({
  method: 'post',
  path: '/',
  tags: ['Cron'],
  summary: 'Create cron job',
  operationId: 'createCronJob',
  request: { body: { content: { 'application/json': { schema: CreateCronJobSchema } } } },
  responses: {
    201: successResponse(CronJobSchema, 'Created job'),
    400: errorResponse('Validation error'),
    409: errorResponse('Job name already exists'),
  },
})

export const deleteCronJob = createRoute({
  method: 'delete',
  path: '/{jobId}',
  tags: ['Cron'],
  summary: 'Soft-delete cron job',
  operationId: 'deleteCronJob',
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: successResponse(z.object({ deleted: z.boolean(), name: z.string() }), 'Deleted'),
    404: errorResponse('Job not found'),
  },
})

export const getCronJobLogs = createRoute({
  method: 'get',
  path: '/{jobId}/logs',
  tags: ['Cron'],
  summary: 'Get logs for a cron job',
  operationId: 'getCronJobLogs',
  request: {
    params: z.object({ jobId: z.string() }),
    query: z.object({
      status: z.enum(['success', 'failed', 'running']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: successResponse(z.object({
      jobName: z.string(),
      logs: z.array(z.object({
        id: z.string(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
        durationMs: z.number().int().nullable(),
        status: z.string(),
        result: z.string().nullable(),
        error: z.string().nullable(),
      })),
      hasMore: z.boolean(),
      nextCursor: z.string().nullable(),
    }), 'Job logs'),
    404: errorResponse('Job not found'),
  },
})

export const triggerCronJob = createRoute({
  method: 'post',
  path: '/{jobId}/trigger',
  tags: ['Cron'],
  summary: 'Manually trigger a cron job',
  operationId: 'triggerCronJob',
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: successResponse(z.object({
      triggered: z.boolean(),
      name: z.string(),
      log: z.object({
        status: z.string(),
        durationMs: z.number().int().nullable(),
        result: z.string().nullable(),
        error: z.string().nullable(),
      }).nullable(),
    }), 'Triggered'),
    404: errorResponse('Job not found'),
    409: errorResponse('Job already running'),
    500: errorResponse('Internal error'),
  },
})

export const pauseCronJob = createRoute({
  method: 'post',
  path: '/{jobId}/pause',
  tags: ['Cron'],
  summary: 'Pause a cron job',
  operationId: 'pauseCronJob',
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: successResponse(z.object({ paused: z.boolean(), name: z.string() }), 'Paused'),
    404: errorResponse('Job not found'),
  },
})

export const resumeCronJob = createRoute({
  method: 'post',
  path: '/{jobId}/resume',
  tags: ['Cron'],
  summary: 'Resume a paused cron job',
  operationId: 'resumeCronJob',
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: successResponse(z.object({ resumed: z.boolean(), name: z.string() }), 'Resumed'),
    404: errorResponse('Job not found'),
  },
})

// ── Events ─────────────────────────────────────────────

export const getEventStream = createRoute({
  method: 'get',
  path: '/',
  tags: ['Events'],
  summary: 'Server-Sent Events stream',
  description: 'Real-time event stream. Event types: log, log-updated, log-removed, tool-progress, tool-group, state, done, issue-updated, changes-summary, heartbeat (15s).',
  operationId: 'getEventStream',
  responses: {
    200: {
      description: 'SSE stream',
      content: { 'text/event-stream': { schema: z.string() } },
    },
  },
})

// ── Processes ──────────────────────────────────────────

export const listProcesses = createRoute({
  method: 'get',
  path: '/',
  tags: ['Processes'],
  summary: 'List active engine processes',
  operationId: 'listProcesses',
  responses: {
    200: successResponse(z.object({ processes: z.array(ProcessInfoSchema) }), 'Active processes'),
  },
})

export const getProcessCapacity = createRoute({
  method: 'get',
  path: '/capacity',
  tags: ['Processes'],
  summary: 'Get execution capacity summary',
  operationId: 'getProcessCapacity',
  responses: {
    200: successResponse(ProcessCapacitySchema, 'Execution capacity summary'),
  },
})

export const terminateProcess = createRoute({
  method: 'post',
  path: '/{issueId}/terminate',
  tags: ['Processes'],
  summary: 'Terminate engine process for issue',
  operationId: 'terminateProcess',
  request: { params: z.object({ issueId: z.string() }) },
  responses: {
    200: successResponse(z.object({ issueId: z.string(), status: z.string() }), 'Terminated'),
    400: errorResponse('Failed to terminate'),
    404: errorResponse('Issue not found'),
  },
})

// ── Worktrees ──────────────────────────────────────────

export const listWorktrees = createRoute({
  method: 'get',
  path: '/',
  tags: ['Worktrees'],
  summary: 'List worktrees for project',
  operationId: 'listWorktrees',
  responses: {
    200: successResponse(z.array(WorktreeEntrySchema), 'Worktree list'),
    404: errorResponse('Project not found'),
  },
})

export const deleteWorktree = createRoute({
  method: 'delete',
  path: '/{issueId}',
  tags: ['Worktrees'],
  summary: 'Force-delete a worktree',
  operationId: 'deleteWorktree',
  request: { params: z.object({ issueId: z.string() }) },
  responses: {
    200: successResponse(z.object({ issueId: z.string() }), 'Deleted'),
    400: errorResponse('Invalid issueId'),
    404: errorResponse('Worktree not found'),
    500: errorResponse('Delete failed'),
  },
})

// ── Notes ──────────────────────────────────────────────

export const listNotes = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notes'],
  summary: 'List notes',
  operationId: 'listNotes',
  responses: {
    200: successResponse(z.array(NoteSchema), 'Note list'),
    500: errorResponse('Internal error'),
  },
})

export const createNote = createRoute({
  method: 'post',
  path: '/',
  tags: ['Notes'],
  summary: 'Create note',
  operationId: 'createNote',
  request: { body: { content: { 'application/json': { schema: CreateNoteSchema } } } },
  responses: {
    201: successResponse(NoteSchema, 'Created note'),
    500: errorResponse('Internal error'),
  },
})

export const updateNote = createRoute({
  method: 'patch',
  path: '/{noteId}',
  tags: ['Notes'],
  summary: 'Update note',
  operationId: 'updateNote',
  request: {
    params: z.object({ noteId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateNoteSchema } } },
  },
  responses: {
    200: successResponse(NoteSchema, 'Updated note'),
    404: errorResponse('Note not found'),
    500: errorResponse('Internal error'),
  },
})

export const deleteNote = createRoute({
  method: 'delete',
  path: '/{noteId}',
  tags: ['Notes'],
  summary: 'Soft-delete note',
  operationId: 'deleteNote',
  request: { params: z.object({ noteId: z.string() }) },
  responses: {
    200: successResponse(z.object({ id: z.string() }), 'Deleted'),
    404: errorResponse('Note not found'),
    500: errorResponse('Internal error'),
  },
})

// ── Webhooks ───────────────────────────────────────────

export const listWebhooks = createRoute({
  method: 'get',
  path: '/webhooks',
  tags: ['Webhooks'],
  summary: 'List webhooks',
  operationId: 'listWebhooks',
  responses: {
    200: successResponse(z.array(WebhookSchema), 'Webhook list'),
  },
})

export const createWebhook = createRoute({
  method: 'post',
  path: '/webhooks',
  tags: ['Webhooks'],
  summary: 'Create webhook',
  operationId: 'createWebhook',
  request: { body: { content: { 'application/json': { schema: CreateWebhookSchema } } } },
  responses: {
    201: successResponse(WebhookSchema, 'Created webhook'),
    400: errorResponse('Validation error'),
  },
})

export const updateWebhook = createRoute({
  method: 'patch',
  path: '/webhooks/{webhookId}',
  tags: ['Webhooks'],
  summary: 'Update webhook',
  operationId: 'updateWebhook',
  request: {
    params: z.object({ webhookId: z.string() }),
    body: { content: { 'application/json': { schema: UpdateWebhookSchema } } },
  },
  responses: {
    200: successResponse(WebhookSchema, 'Updated webhook'),
    400: errorResponse('Validation error'),
    404: errorResponse('Webhook not found'),
  },
})

export const deleteWebhook = createRoute({
  method: 'delete',
  path: '/webhooks/{webhookId}',
  tags: ['Webhooks'],
  summary: 'Soft-delete webhook',
  operationId: 'deleteWebhook',
  request: { params: z.object({ webhookId: z.string() }) },
  responses: {
    200: successResponse(z.object({ id: z.string() }), 'Deleted'),
    404: errorResponse('Webhook not found'),
  },
})

export const getWebhookDeliveries = createRoute({
  method: 'get',
  path: '/webhooks/{webhookId}/deliveries',
  tags: ['Webhooks'],
  summary: 'List webhook deliveries (last 50)',
  operationId: 'getWebhookDeliveries',
  request: { params: z.object({ webhookId: z.string() }) },
  responses: {
    200: successResponse(z.array(WebhookDeliverySchema), 'Deliveries'),
    404: errorResponse('Webhook not found'),
  },
})

export const testWebhook = createRoute({
  method: 'post',
  path: '/webhooks/{webhookId}/test',
  tags: ['Webhooks'],
  summary: 'Send test webhook delivery',
  operationId: 'testWebhook',
  request: { params: z.object({ webhookId: z.string() }) },
  responses: {
    200: successResponse(z.object({ sent: z.boolean() }), 'Sent'),
    404: errorResponse('Webhook not found'),
  },
})

// ── Settings ───────────────────────────────────────────

export const getWorkspacePath = createRoute({
  method: 'get',
  path: '/workspace-path',
  tags: ['Settings'],
  summary: 'Get workspace path',
  operationId: 'getWorkspacePath',
  responses: { 200: successResponse(z.object({ path: z.string() }), 'Workspace path') },
})

export const setWorkspacePath = createRoute({
  method: 'patch',
  path: '/workspace-path',
  tags: ['Settings'],
  summary: 'Set workspace path',
  operationId: 'setWorkspacePath',
  request: { body: { content: { 'application/json': { schema: z.object({ path: z.string().min(1).max(1024) }) } } } },
  responses: {
    200: successResponse(z.object({ path: z.string() }), 'Updated'),
    400: errorResponse('Invalid path'),
  },
})

export const getServerInfo = createRoute({
  method: 'get',
  path: '/server-info',
  tags: ['Settings'],
  summary: 'Get server name and URL',
  operationId: 'getServerInfo',
  responses: { 200: successResponse(z.object({ name: z.string().nullable(), url: z.string().nullable() }), 'Server info') },
})

export const setServerInfo = createRoute({
  method: 'patch',
  path: '/server-info',
  tags: ['Settings'],
  summary: 'Update server name and/or URL',
  operationId: 'setServerInfo',
  request: {
    body: { content: { 'application/json': { schema: z.object({ name: z.string().max(128).optional(), url: z.string().max(1024).optional() }) } } },
  },
  responses: { 200: successResponse(z.object({ name: z.string(), url: z.string() }), 'Updated') },
})

export const getLogPageSize = createRoute({
  method: 'get',
  path: '/log-page-size',
  tags: ['Settings'],
  summary: 'Get log page size',
  operationId: 'getLogPageSize',
  responses: { 200: successResponse(z.object({ size: z.number().int() }), 'Page size') },
})

export const setLogPageSize = createRoute({
  method: 'patch',
  path: '/log-page-size',
  tags: ['Settings'],
  summary: 'Set log page size',
  operationId: 'setLogPageSize',
  request: { body: { content: { 'application/json': { schema: z.object({ size: z.number().int().min(5).max(200) }) } } } },
  responses: { 200: successResponse(z.object({ size: z.number().int() }), 'Updated') },
})

export const getMaxConcurrent = createRoute({
  method: 'get',
  path: '/max-concurrent-executions',
  tags: ['Settings'],
  summary: 'Get max concurrent executions',
  operationId: 'getMaxConcurrent',
  responses: { 200: successResponse(z.object({ value: z.number().int() }), 'Value') },
})

export const setMaxConcurrent = createRoute({
  method: 'patch',
  path: '/max-concurrent-executions',
  tags: ['Settings'],
  summary: 'Set max concurrent executions',
  operationId: 'setMaxConcurrent',
  request: { body: { content: { 'application/json': { schema: z.object({ value: z.number().int().min(1).max(50) }) } } } },
  responses: { 200: successResponse(z.object({ value: z.number().int() }), 'Updated') },
})

export const getWriteFilterRules = createRoute({
  method: 'get',
  path: '/write-filter-rules',
  tags: ['Settings'],
  summary: 'Get write filter rules',
  operationId: 'getWriteFilterRules',
  responses: { 200: successResponse(z.array(WriteFilterRuleSchema), 'Rules') },
})

export const setWriteFilterRules = createRoute({
  method: 'put',
  path: '/write-filter-rules',
  tags: ['Settings'],
  summary: 'Replace all write filter rules',
  operationId: 'setWriteFilterRules',
  request: { body: { content: { 'application/json': { schema: z.object({ rules: z.array(WriteFilterRuleSchema) }) } } } },
  responses: { 200: successResponse(z.array(WriteFilterRuleSchema), 'Updated') },
})

export const getGlobalSlashCommands = createRoute({
  method: 'get',
  path: '/slash-commands',
  tags: ['Settings'],
  summary: 'Get cached slash commands',
  operationId: 'getGlobalSlashCommands',
  request: { query: z.object({ engine: z.string().optional() }) },
  responses: {
    200: successResponse(CategorizedCommandsSchema, 'Categorized commands'),
    400: errorResponse('Invalid engine type'),
  },
})
