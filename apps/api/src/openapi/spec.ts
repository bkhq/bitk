import { VERSION } from '@/version'

/** OpenAPI 3.1.0 specification for the BKD API */
export function buildOpenAPISpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BKD API',
      description: 'Kanban board for managing AI coding agents. Issues are assigned to CLI-based AI engines (Claude Code, Codex, Gemini CLI) that execute autonomously.',
      version: VERSION,
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api', description: 'API base' }],
    tags: [
      { name: 'Meta', description: 'Health, status, and runtime information' },
      { name: 'Projects', description: 'Project CRUD and lifecycle' },
      { name: 'Issues', description: 'Issue CRUD, bulk updates, and execution' },
      { name: 'Issue Commands', description: 'Execute, follow-up, restart, cancel AI sessions' },
      { name: 'Issue Logs', description: 'Retrieve and filter issue conversation logs' },
      { name: 'Engines', description: 'AI engine discovery, settings, and models' },
      { name: 'Cron', description: 'Scheduled job management' },
      { name: 'Events', description: 'Server-Sent Events for real-time updates' },
      { name: 'Processes', description: 'Active engine process management' },
      { name: 'Worktrees', description: 'Git worktree management per project' },
      { name: 'Files', description: 'File browser and raw file access' },
      { name: 'Notes', description: 'Scratch notes' },
      { name: 'Settings', description: 'Application settings and configuration' },
      { name: 'Webhooks', description: 'Webhook notification management' },
    ],
    paths: {
      // ── Meta ─────────────────────────────────────────
      '/': {
        get: {
          tags: ['Meta'],
          summary: 'API root',
          operationId: 'getApiRoot',
          responses: {
            200: jsonResponse('API info', {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'bkd-api' },
                status: { type: 'string', example: 'ok' },
                routes: { type: 'array', items: { type: 'string' } },
              },
            }),
          },
        },
      },
      '/health': {
        get: {
          tags: ['Meta'],
          summary: 'Health check',
          operationId: 'getHealth',
          responses: {
            200: jsonResponse('Health status', {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                version: { type: 'string' },
                commit: { type: 'string' },
                db: { type: 'string', enum: ['ok', 'error'] },
                timestamp: { type: 'string', format: 'date-time' },
              },
            }),
          },
        },
      },
      '/status': {
        get: {
          tags: ['Meta'],
          summary: 'Detailed server status',
          operationId: 'getStatus',
          responses: {
            200: jsonResponse('Server status', {
              type: 'object',
              properties: {
                uptime: { type: 'number' },
                memory: {
                  type: 'object',
                  properties: {
                    rss: { type: 'integer' },
                    heapUsed: { type: 'integer' },
                    heapTotal: { type: 'integer' },
                  },
                },
                db: { type: 'object' },
              },
            }),
          },
        },
      },
      '/runtime': {
        get: {
          tags: ['Meta'],
          summary: 'Runtime info (requires ENABLE_RUNTIME_ENDPOINT=true)',
          operationId: 'getRuntime',
          responses: {
            200: jsonResponse('Runtime info', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Projects ─────────────────────────────────────
      '/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          operationId: 'listProjects',
          parameters: [
            { name: 'archived', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter by archived status' },
          ],
          responses: {
            200: jsonResponse('Project list', { type: 'array', items: ref('Project') }),
          },
        },
        post: {
          tags: ['Projects'],
          summary: 'Create project',
          operationId: 'createProject',
          requestBody: jsonBody(ref('CreateProject')),
          responses: {
            201: jsonResponse('Created project', ref('Project')),
            400: ref('ErrorResponse'),
            409: ref('ErrorResponse'),
          },
        },
      },
      '/projects/sort': {
        patch: {
          tags: ['Projects'],
          summary: 'Reorder a project',
          operationId: 'sortProject',
          requestBody: jsonBody({
            type: 'object',
            required: ['id', 'sortOrder'],
            properties: {
              id: { type: 'string' },
              sortOrder: { type: 'string', pattern: '^[a-zA-Z0-9]+$' },
            },
          }),
          responses: {
            200: jsonResponse('Success', { type: 'null' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}': {
        get: {
          tags: ['Projects'],
          summary: 'Get project',
          operationId: 'getProject',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Project', ref('Project')),
            404: ref('ErrorResponse'),
          },
        },
        patch: {
          tags: ['Projects'],
          summary: 'Update project',
          operationId: 'updateProject',
          parameters: [projectIdParam()],
          requestBody: jsonBody(ref('UpdateProject')),
          responses: {
            200: jsonResponse('Updated project', ref('Project')),
            404: ref('ErrorResponse'),
            409: ref('ErrorResponse'),
          },
        },
        delete: {
          tags: ['Projects'],
          summary: 'Soft-delete project (terminates active sessions)',
          operationId: 'deleteProject',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { id: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/archive': {
        post: {
          tags: ['Projects'],
          summary: 'Archive project',
          operationId: 'archiveProject',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Archived project', ref('Project')),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/unarchive': {
        post: {
          tags: ['Projects'],
          summary: 'Unarchive project',
          operationId: 'unarchiveProject',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Unarchived project', ref('Project')),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Issues ───────────────────────────────────────
      '/projects/{projectId}/issues': {
        get: {
          tags: ['Issues'],
          summary: 'List issues in project',
          operationId: 'listIssues',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Issue list', { type: 'array', items: ref('Issue') }),
            404: ref('ErrorResponse'),
          },
        },
        post: {
          tags: ['Issues'],
          summary: 'Create issue (auto-executes if status is working)',
          operationId: 'createIssue',
          parameters: [projectIdParam()],
          requestBody: jsonBody(ref('CreateIssue')),
          responses: {
            201: jsonResponse('Created issue', ref('Issue')),
            202: jsonResponse('Created and executing', ref('Issue')),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/bulk': {
        patch: {
          tags: ['Issues'],
          summary: 'Bulk update issues (status, sort order)',
          operationId: 'bulkUpdateIssues',
          parameters: [projectIdParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['updates'],
            properties: {
              updates: {
                type: 'array',
                maxItems: 1000,
                items: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string' },
                    statusId: { type: 'string', enum: ['todo', 'working', 'review', 'done'] },
                    sortOrder: { type: 'string' },
                  },
                },
              },
            },
          }),
          responses: {
            200: jsonResponse('Updated issues', { type: 'array', items: ref('Issue') }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}': {
        get: {
          tags: ['Issues'],
          summary: 'Get issue',
          operationId: 'getIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Issue', ref('Issue')),
            404: ref('ErrorResponse'),
          },
        },
        patch: {
          tags: ['Issues'],
          summary: 'Update issue',
          operationId: 'updateIssue',
          parameters: [projectIdParam(), issueIdParam()],
          requestBody: jsonBody(ref('UpdateIssue')),
          responses: {
            200: jsonResponse('Updated issue', ref('Issue')),
            404: ref('ErrorResponse'),
          },
        },
        delete: {
          tags: ['Issues'],
          summary: 'Soft-delete issue',
          operationId: 'deleteIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { id: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/duplicate': {
        post: {
          tags: ['Issues'],
          summary: 'Duplicate issue',
          operationId: 'duplicateIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            201: jsonResponse('Duplicated issue', ref('Issue')),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Issue Commands ───────────────────────────────
      '/projects/{projectId}/issues/{issueId}/execute': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Start AI execution on issue',
          operationId: 'executeIssue',
          parameters: [projectIdParam(), issueIdParam()],
          requestBody: jsonBody(ref('ExecuteIssue')),
          responses: {
            200: jsonResponse('Execution started', ref('ExecuteIssueResponse')),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/follow-up': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Send follow-up message to active/completed session',
          operationId: 'followUpIssue',
          parameters: [projectIdParam(), issueIdParam()],
          requestBody: jsonBody(ref('FollowUp')),
          responses: {
            200: jsonResponse('Follow-up sent', ref('ExecuteIssueResponse')),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/restart': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Restart failed session',
          operationId: 'restartIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Restarted', ref('ExecuteIssueResponse')),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/cancel': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Cancel active session',
          operationId: 'cancelIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Cancelled', { type: 'object', properties: { issueId: { type: 'string' }, cancelled: { type: 'boolean' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/messages': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Queue a pending message',
          operationId: 'createMessage',
          parameters: [projectIdParam(), issueIdParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', maxLength: 32768 },
              model: { type: 'string' },
              permissionMode: { type: 'string', enum: ['auto', 'supervised', 'plan'] },
              busyAction: { type: 'string', enum: ['queue', 'cancel'] },
              meta: { type: 'boolean' },
              displayPrompt: { type: 'string', maxLength: 500 },
            },
          }),
          responses: {
            200: jsonResponse('Message queued', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/pending': {
        delete: {
          tags: ['Issue Commands'],
          summary: 'Recall a pending message',
          operationId: 'recallPendingMessage',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'messageId', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: jsonResponse('Recalled', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/auto-title': {
        post: {
          tags: ['Issue Commands'],
          summary: 'Auto-generate title from conversation',
          operationId: 'autoTitleIssue',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Generated title', { type: 'object', properties: { title: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/slash-commands': {
        get: {
          tags: ['Issue Commands'],
          summary: 'List available slash commands for issue engine',
          operationId: 'getSlashCommands',
          parameters: [projectIdParam(), issueIdParam()],
          responses: {
            200: jsonResponse('Slash commands', ref('CategorizedCommands')),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Issue Logs ───────────────────────────────────
      '/projects/{projectId}/issues/{issueId}/logs': {
        get: {
          tags: ['Issue Logs'],
          summary: 'Get issue logs (paginated)',
          operationId: 'getIssueLogs',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Pagination cursor (ULID)' },
            { name: 'before', in: 'query', schema: { type: 'string' }, description: 'Fetch logs before this cursor' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          ],
          responses: {
            200: jsonResponse('Issue logs', ref('IssueLogsResponse')),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/logs/filter/{filterPath}': {
        get: {
          tags: ['Issue Logs'],
          summary: 'Get filtered issue logs',
          description: 'Path-based key/value filter pairs (order-independent):\n- `types/<comma-separated>` — filter by entry type\n- `turn/<value>` — filter by turn: single (`3`), range (`2-5`), `last`, or `lastN` (`last3`)\n\nExample: `/logs/filter/types/user-message,assistant-message/turn/last3`',
          operationId: 'getFilteredIssueLogs',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'filterPath', in: 'path', required: true, schema: { type: 'string' }, description: 'Filter path (e.g. types/user-message,assistant-message/turn/last3)' },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'before', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: jsonResponse('Filtered logs', ref('IssueLogsResponse')),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/changes': {
        get: {
          tags: ['Issue Logs'],
          summary: 'Get file changes for issue',
          operationId: 'getIssueChanges',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'path', in: 'query', schema: { type: 'string' }, description: 'Get patch for specific file' },
          ],
          responses: {
            200: jsonResponse('File changes', ref('IssueChangesResponse')),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/export': {
        get: {
          tags: ['Issue Logs'],
          summary: 'Export issue conversation logs',
          operationId: 'exportIssueLogs',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['markdown', 'json'] } },
          ],
          responses: {
            200: { description: 'Exported logs (text/markdown or application/json)' },
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/issues/{issueId}/attachments/{attachmentId}': {
        get: {
          tags: ['Issue Logs'],
          summary: 'Serve attachment file',
          operationId: 'getAttachment',
          parameters: [
            projectIdParam(),
            issueIdParam(),
            { name: 'attachmentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Attachment file content' },
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Review Issues (cross-project) ────────────────
      '/issues/review': {
        post: {
          tags: ['Issues'],
          summary: 'Get issues in review status across projects',
          operationId: 'getReviewIssues',
          responses: {
            200: jsonResponse('Review issues', { type: 'array', items: ref('Issue') }),
          },
        },
      },

      // ── Engines ──────────────────────────────────────
      '/engines/available': {
        get: {
          tags: ['Engines'],
          summary: 'List detected engines and their models',
          operationId: 'getAvailableEngines',
          responses: {
            200: jsonResponse('Engine discovery result', ref('EngineDiscoveryResult')),
          },
        },
      },
      '/engines/profiles': {
        get: {
          tags: ['Engines'],
          summary: 'List engine profiles',
          operationId: 'getEngineProfiles',
          responses: {
            200: jsonResponse('Engine profiles', { type: 'array', items: ref('EngineProfile') }),
          },
        },
      },
      '/engines/settings': {
        get: {
          tags: ['Engines'],
          summary: 'Get engine settings (default engine + per-engine models)',
          operationId: 'getEngineSettings',
          responses: {
            200: jsonResponse('Engine settings', ref('EngineSettings')),
          },
        },
      },
      '/engines/default-engine': {
        patch: {
          tags: ['Engines'],
          summary: 'Set default engine',
          operationId: 'setDefaultEngine',
          requestBody: jsonBody({
            type: 'object',
            required: ['defaultEngine'],
            properties: {
              defaultEngine: { type: 'string', description: 'Engine type (claude-code, codex, acp, acp:*)' },
            },
          }),
          responses: {
            200: jsonResponse('Updated', { type: 'object', properties: { defaultEngine: { type: 'string' } } }),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/engines/{engineType}/settings': {
        patch: {
          tags: ['Engines'],
          summary: 'Set default model for engine',
          operationId: 'setEngineModel',
          parameters: [engineTypeParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['defaultModel'],
            properties: { defaultModel: { type: 'string' } },
          }),
          responses: {
            200: jsonResponse('Updated', { type: 'object', properties: { engineType: { type: 'string' }, defaultModel: { type: 'string' } } }),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/engines/{engineType}/hidden-models': {
        patch: {
          tags: ['Engines'],
          summary: 'Update hidden models for engine',
          operationId: 'setHiddenModels',
          parameters: [engineTypeParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['hiddenModels'],
            properties: { hiddenModels: { type: 'array', items: { type: 'string' }, maxItems: 500 } },
          }),
          responses: {
            200: jsonResponse('Updated', { type: 'object' }),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/engines/{engineType}/models': {
        get: {
          tags: ['Engines'],
          summary: 'List available models for an engine',
          operationId: 'getEngineModels',
          parameters: [engineTypeParam()],
          responses: {
            200: jsonResponse('Models', {
              type: 'object',
              properties: {
                engineType: { type: 'string' },
                defaultModel: { type: 'string' },
                models: { type: 'array', items: ref('EngineModel') },
              },
            }),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/engines/probe': {
        post: {
          tags: ['Engines'],
          summary: 'Force live re-probe of all engines',
          operationId: 'probeEngines',
          responses: {
            200: jsonResponse('Probe result', ref('ProbeResult')),
          },
        },
      },

      // ── Cron ─────────────────────────────────────────
      '/cron': {
        get: {
          tags: ['Cron'],
          summary: 'List cron jobs',
          operationId: 'listCronJobs',
          parameters: [
            { name: 'deleted', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'only'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: jsonResponse('Cron jobs', { type: 'object' }),
          },
        },
        post: {
          tags: ['Cron'],
          summary: 'Create cron job',
          operationId: 'createCronJob',
          requestBody: jsonBody(ref('CreateCronJob')),
          responses: {
            201: jsonResponse('Created job', ref('CronJob')),
            400: ref('ErrorResponse'),
            409: ref('ErrorResponse'),
          },
        },
      },
      '/cron/actions': {
        get: {
          tags: ['Cron'],
          summary: 'List available cron actions',
          operationId: 'listCronActions',
          responses: {
            200: jsonResponse('Action list', { type: 'object', properties: { help: { type: 'object' } } }),
          },
        },
      },
      '/cron/{jobId}': {
        delete: {
          tags: ['Cron'],
          summary: 'Soft-delete cron job',
          operationId: 'deleteCronJob',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' }, description: 'Job ID or name' }],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { deleted: { type: 'boolean' }, name: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/cron/{jobId}/logs': {
        get: {
          tags: ['Cron'],
          summary: 'Get logs for a cron job',
          operationId: 'getCronJobLogs',
          parameters: [
            { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'failed', 'running'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: jsonResponse('Job logs', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/cron/{jobId}/trigger': {
        post: {
          tags: ['Cron'],
          summary: 'Manually trigger a cron job',
          operationId: 'triggerCronJob',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Triggered', { type: 'object' }),
            404: ref('ErrorResponse'),
            409: ref('ErrorResponse'),
          },
        },
      },
      '/cron/{jobId}/pause': {
        post: {
          tags: ['Cron'],
          summary: 'Pause a cron job',
          operationId: 'pauseCronJob',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Paused', { type: 'object', properties: { paused: { type: 'boolean' }, name: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/cron/{jobId}/resume': {
        post: {
          tags: ['Cron'],
          summary: 'Resume a paused cron job',
          operationId: 'resumeCronJob',
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Resumed', { type: 'object', properties: { resumed: { type: 'boolean' }, name: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Events ───────────────────────────────────────
      '/events': {
        get: {
          tags: ['Events'],
          summary: 'Server-Sent Events stream',
          description: 'Real-time event stream. Event types: `log`, `log-updated`, `log-removed`, `tool-progress`, `tool-group`, `state`, `done`, `issue-updated`, `changes-summary`, `heartbeat` (15s).',
          operationId: 'getEventStream',
          responses: {
            200: {
              description: 'SSE stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },

      // ── Processes ────────────────────────────────────
      '/processes': {
        get: {
          tags: ['Processes'],
          summary: 'List active engine processes',
          operationId: 'listProcesses',
          responses: {
            200: jsonResponse('Active processes', {
              type: 'object',
              properties: { processes: { type: 'array', items: ref('ProcessInfo') } },
            }),
          },
        },
      },
      '/processes/{issueId}/terminate': {
        post: {
          tags: ['Processes'],
          summary: 'Terminate engine process for issue',
          operationId: 'terminateProcess',
          parameters: [{ name: 'issueId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Terminated', { type: 'object', properties: { issueId: { type: 'string' }, status: { type: 'string' } } }),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Worktrees ────────────────────────────────────
      '/projects/{projectId}/worktrees': {
        get: {
          tags: ['Worktrees'],
          summary: 'List worktrees for project',
          operationId: 'listWorktrees',
          parameters: [projectIdParam()],
          responses: {
            200: jsonResponse('Worktree list', {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  issueId: { type: 'string' },
                  path: { type: 'string' },
                  branch: { type: 'string', nullable: true },
                },
              },
            }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/projects/{projectId}/worktrees/{issueId}': {
        delete: {
          tags: ['Worktrees'],
          summary: 'Force-delete a worktree',
          operationId: 'deleteWorktree',
          parameters: [projectIdParam(), { name: 'issueId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { issueId: { type: 'string' } } }),
            400: ref('ErrorResponse'),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Files ────────────────────────────────────────
      '/files/show': {
        get: {
          tags: ['Files'],
          summary: 'Browse directory or file',
          operationId: 'browseFiles',
          parameters: [
            { name: 'path', in: 'query', schema: { type: 'string' }, description: 'Sub-path to browse' },
          ],
          responses: {
            200: jsonResponse('Directory listing or file content', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/files/raw/{filePath}': {
        get: {
          tags: ['Files'],
          summary: 'Download raw file',
          operationId: 'downloadFile',
          parameters: [{ name: 'filePath', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'File content with appropriate MIME type' },
            404: ref('ErrorResponse'),
          },
        },
      },
      '/files/save/{filePath}': {
        put: {
          tags: ['Files'],
          summary: 'Save file content',
          operationId: 'saveFile',
          parameters: [{ name: 'filePath', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'text/plain': { schema: { type: 'string' } } } },
          responses: {
            200: jsonResponse('Saved', { type: 'object' }),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/files/delete/{filePath}': {
        delete: {
          tags: ['Files'],
          summary: 'Delete file',
          operationId: 'deleteFile',
          parameters: [{ name: 'filePath', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Deleted', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Notes ────────────────────────────────────────
      '/notes': {
        get: {
          tags: ['Notes'],
          summary: 'List notes',
          operationId: 'listNotes',
          responses: {
            200: jsonResponse('Note list', { type: 'array', items: ref('Note') }),
          },
        },
        post: {
          tags: ['Notes'],
          summary: 'Create note',
          operationId: 'createNote',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 500 },
              content: { type: 'string', maxLength: 100000 },
            },
          }),
          responses: {
            201: jsonResponse('Created note', ref('Note')),
          },
        },
      },
      '/notes/{noteId}': {
        patch: {
          tags: ['Notes'],
          summary: 'Update note',
          operationId: 'updateNote',
          parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 500 },
              content: { type: 'string', maxLength: 100000 },
              isPinned: { type: 'boolean' },
            },
          }),
          responses: {
            200: jsonResponse('Updated note', ref('Note')),
            404: ref('ErrorResponse'),
          },
        },
        delete: {
          tags: ['Notes'],
          summary: 'Soft-delete note',
          operationId: 'deleteNote',
          parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { id: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Settings ─────────────────────────────────────
      '/settings/workspace-path': {
        get: {
          tags: ['Settings'],
          summary: 'Get workspace path',
          operationId: 'getWorkspacePath',
          responses: { 200: jsonResponse('Workspace path', { type: 'object', properties: { path: { type: 'string' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Set workspace path',
          operationId: 'setWorkspacePath',
          requestBody: jsonBody({ type: 'object', required: ['path'], properties: { path: { type: 'string', maxLength: 1024 } } }),
          responses: {
            200: jsonResponse('Updated', { type: 'object', properties: { path: { type: 'string' } } }),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/settings/server-info': {
        get: {
          tags: ['Settings'],
          summary: 'Get server name and URL',
          operationId: 'getServerInfo',
          responses: { 200: jsonResponse('Server info', { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Update server name and/or URL',
          operationId: 'setServerInfo',
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string', maxLength: 128 }, url: { type: 'string', maxLength: 1024 } } }),
          responses: { 200: jsonResponse('Updated', { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } } }) },
        },
      },
      '/settings/log-page-size': {
        get: {
          tags: ['Settings'],
          summary: 'Get log page size',
          operationId: 'getLogPageSize',
          responses: { 200: jsonResponse('Page size', { type: 'object', properties: { size: { type: 'integer' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Set log page size',
          operationId: 'setLogPageSize',
          requestBody: jsonBody({ type: 'object', required: ['size'], properties: { size: { type: 'integer', minimum: 5, maximum: 200 } } }),
          responses: { 200: jsonResponse('Updated', { type: 'object', properties: { size: { type: 'integer' } } }) },
        },
      },
      '/settings/max-concurrent-executions': {
        get: {
          tags: ['Settings'],
          summary: 'Get max concurrent executions',
          operationId: 'getMaxConcurrent',
          responses: { 200: jsonResponse('Value', { type: 'object', properties: { value: { type: 'integer' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Set max concurrent executions',
          operationId: 'setMaxConcurrent',
          requestBody: jsonBody({ type: 'object', required: ['value'], properties: { value: { type: 'integer', minimum: 1, maximum: 50 } } }),
          responses: { 200: jsonResponse('Updated', { type: 'object', properties: { value: { type: 'integer' } } }) },
        },
      },
      '/settings/worktree-auto-cleanup': {
        get: {
          tags: ['Settings'],
          summary: 'Get worktree auto-cleanup setting',
          operationId: 'getWorktreeAutoCleanup',
          responses: { 200: jsonResponse('Enabled', { type: 'object', properties: { enabled: { type: 'boolean' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Toggle worktree auto-cleanup',
          operationId: 'setWorktreeAutoCleanup',
          requestBody: jsonBody({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }),
          responses: { 200: jsonResponse('Updated', { type: 'object', properties: { enabled: { type: 'boolean' } } }) },
        },
      },
      '/settings/write-filter-rules': {
        get: {
          tags: ['Settings'],
          summary: 'Get write filter rules',
          operationId: 'getWriteFilterRules',
          responses: { 200: jsonResponse('Rules', { type: 'array', items: ref('WriteFilterRule') }) },
        },
        put: {
          tags: ['Settings'],
          summary: 'Replace all write filter rules',
          operationId: 'setWriteFilterRules',
          requestBody: jsonBody({ type: 'object', required: ['rules'], properties: { rules: { type: 'array', items: ref('WriteFilterRule') } } }),
          responses: { 200: jsonResponse('Updated', { type: 'array', items: ref('WriteFilterRule') }) },
        },
      },
      '/settings/write-filter-rules/{ruleId}': {
        patch: {
          tags: ['Settings'],
          summary: 'Toggle a write filter rule',
          operationId: 'toggleWriteFilterRule',
          parameters: [{ name: 'ruleId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }),
          responses: {
            200: jsonResponse('Updated rule', ref('WriteFilterRule')),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/settings/mcp': {
        get: {
          tags: ['Settings'],
          summary: 'Get MCP settings',
          operationId: 'getMcpSettings',
          responses: { 200: jsonResponse('MCP settings', { type: 'object', properties: { enabled: { type: 'boolean' }, apiKey: { type: 'string', nullable: true }, envOverride: { type: 'object' } } }) },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Update MCP settings',
          operationId: 'setMcpSettings',
          requestBody: jsonBody({ type: 'object', properties: { enabled: { type: 'boolean' }, apiKey: { type: 'string', maxLength: 256 } } }),
          responses: { 200: jsonResponse('Updated', { type: 'object' }) },
        },
      },
      '/settings/slash-commands': {
        get: {
          tags: ['Settings'],
          summary: 'Get cached slash commands',
          operationId: 'getGlobalSlashCommands',
          parameters: [{ name: 'engine', in: 'query', schema: { type: 'string' }, description: 'Filter by engine type' }],
          responses: { 200: jsonResponse('Categorized commands', ref('CategorizedCommands')) },
        },
      },
      '/settings/system-logs': {
        get: {
          tags: ['Settings'],
          summary: 'Get system logs',
          operationId: 'getSystemLogs',
          responses: { 200: jsonResponse('System logs', { type: 'array', items: { type: 'object' } }) },
        },
        delete: {
          tags: ['Settings'],
          summary: 'Clear system logs',
          operationId: 'clearSystemLogs',
          responses: { 200: jsonResponse('Cleared', { type: 'object' }) },
        },
      },
      '/settings/cleanup': {
        post: {
          tags: ['Settings'],
          summary: 'Run cleanup tasks',
          operationId: 'runCleanup',
          responses: { 200: jsonResponse('Cleanup result', { type: 'object' }) },
        },
      },
      '/settings/recycle-bin': {
        get: {
          tags: ['Settings'],
          summary: 'List soft-deleted items',
          operationId: 'getRecycleBin',
          responses: { 200: jsonResponse('Deleted items', { type: 'array', items: { type: 'object' } }) },
        },
      },
      '/settings/recycle-bin/{id}/restore': {
        post: {
          tags: ['Settings'],
          summary: 'Restore soft-deleted item',
          operationId: 'restoreItem',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Restored', { type: 'object' }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/settings/about': {
        get: {
          tags: ['Settings'],
          summary: 'Get application info',
          operationId: 'getAbout',
          responses: { 200: jsonResponse('About info', { type: 'object' }) },
        },
      },

      // ── Webhooks ─────────────────────────────────────
      '/settings/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhooks',
          operationId: 'listWebhooks',
          responses: { 200: jsonResponse('Webhook list', { type: 'array', items: ref('Webhook') }) },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Create webhook',
          operationId: 'createWebhook',
          requestBody: jsonBody(ref('CreateWebhook')),
          responses: {
            201: jsonResponse('Created webhook', ref('Webhook')),
            400: ref('ErrorResponse'),
          },
        },
      },
      '/settings/webhooks/{webhookId}': {
        patch: {
          tags: ['Webhooks'],
          summary: 'Update webhook',
          operationId: 'updateWebhook',
          parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(ref('UpdateWebhook')),
          responses: {
            200: jsonResponse('Updated webhook', ref('Webhook')),
            404: ref('ErrorResponse'),
          },
        },
        delete: {
          tags: ['Webhooks'],
          summary: 'Soft-delete webhook',
          operationId: 'deleteWebhook',
          parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Deleted', { type: 'object', properties: { id: { type: 'string' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/settings/webhooks/{webhookId}/deliveries': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhook deliveries (last 50)',
          operationId: 'getWebhookDeliveries',
          parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Deliveries', { type: 'array', items: ref('WebhookDelivery') }),
            404: ref('ErrorResponse'),
          },
        },
      },
      '/settings/webhooks/{webhookId}/test': {
        post: {
          tags: ['Webhooks'],
          summary: 'Send test webhook delivery',
          operationId: 'testWebhook',
          parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: jsonResponse('Sent', { type: 'object', properties: { sent: { type: 'boolean' } } }),
            404: ref('ErrorResponse'),
          },
        },
      },

      // ── Git ──────────────────────────────────────────
      '/git/detect-remote': {
        post: {
          tags: ['Settings'],
          summary: 'Detect git remote URL for a directory',
          operationId: 'detectGitRemote',
          requestBody: jsonBody({ type: 'object', required: ['directory'], properties: { directory: { type: 'string' } } }),
          responses: { 200: jsonResponse('Remote info', { type: 'object' }) },
        },
      },
    },

    components: {
      schemas: {
        // ── Envelope ───────────────────────────────
        ErrorResponse: {
          description: 'Error response envelope',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'error'],
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                },
              },
            },
          },
        },

        // ── Project ────────────────────────────────
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'nanoid 8-char' },
            alias: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            directory: { type: 'string' },
            repositoryUrl: { type: 'string', format: 'uri' },
            systemPrompt: { type: 'string' },
            envVars: { type: 'object', additionalProperties: { type: 'string' } },
            sortOrder: { type: 'string' },
            isArchived: { type: 'boolean' },
            isGitRepo: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateProject: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            alias: { type: 'string', maxLength: 200, pattern: '^[a-z0-9]+$' },
            description: { type: 'string', maxLength: 5000 },
            directory: { type: 'string', maxLength: 1000 },
            repositoryUrl: { type: 'string', format: 'uri' },
            systemPrompt: { type: 'string', maxLength: 32768 },
            envVars: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        UpdateProject: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            alias: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 5000 },
            directory: { type: 'string', maxLength: 1000 },
            repositoryUrl: { type: 'string' },
            systemPrompt: { type: 'string', maxLength: 32768 },
            envVars: { type: 'object', additionalProperties: { type: 'string' } },
            sortOrder: { type: 'string' },
          },
        },

        // ── Issue ──────────────────────────────────
        Issue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            statusId: { type: 'string', enum: ['todo', 'working', 'review', 'done'] },
            issueNumber: { type: 'integer' },
            title: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' }, nullable: true },
            sortOrder: { type: 'string' },
            useWorktree: { type: 'boolean' },
            isPinned: { type: 'boolean' },
            keepAlive: { type: 'boolean' },
            engineType: { type: 'string', nullable: true, description: 'claude-code | codex | acp | acp:*' },
            sessionStatus: { type: 'string', nullable: true, enum: ['pending', 'running', 'completed', 'failed', 'cancelled', null] },
            prompt: { type: 'string', nullable: true },
            externalSessionId: { type: 'string', nullable: true },
            model: { type: 'string', nullable: true },
            statusUpdatedAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateIssue: {
          type: 'object',
          required: ['title', 'statusId'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            tags: { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 10 },
            statusId: { type: 'string', enum: ['todo', 'working', 'review', 'done'] },
            useWorktree: { type: 'boolean' },
            keepAlive: { type: 'boolean' },
            engineType: { type: 'string' },
            model: { type: 'string' },
            permissionMode: { type: 'string', enum: ['auto', 'supervised', 'plan'] },
          },
        },
        UpdateIssue: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            tags: { type: 'array', items: { type: 'string' }, nullable: true },
            statusId: { type: 'string', enum: ['todo', 'working', 'review', 'done'] },
            sortOrder: { type: 'string' },
            isPinned: { type: 'boolean' },
            keepAlive: { type: 'boolean' },
          },
        },
        ExecuteIssue: {
          type: 'object',
          required: ['engineType', 'prompt'],
          properties: {
            engineType: { type: 'string', description: 'claude-code | codex | acp | acp:*' },
            prompt: { type: 'string', minLength: 1, maxLength: 32768 },
            model: { type: 'string' },
            permissionMode: { type: 'string', enum: ['auto', 'supervised', 'plan'] },
          },
        },
        FollowUp: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 32768 },
            model: { type: 'string' },
            permissionMode: { type: 'string', enum: ['auto', 'supervised', 'plan'] },
            busyAction: { type: 'string', enum: ['queue', 'cancel'] },
            meta: { type: 'boolean' },
            displayPrompt: { type: 'string', maxLength: 500 },
          },
        },
        ExecuteIssueResponse: {
          type: 'object',
          properties: {
            executionId: { type: 'string' },
            issueId: { type: 'string' },
            messageId: { type: 'string' },
            queued: { type: 'boolean' },
          },
        },

        // ── Logs ───────────────────────────────────
        NormalizedLogEntry: {
          type: 'object',
          properties: {
            messageId: { type: 'string' },
            replyToMessageId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            turnIndex: { type: 'integer' },
            entryType: { type: 'string', enum: ['user-message', 'assistant-message', 'tool-use', 'system-message', 'error-message', 'thinking', 'loading', 'token-usage'] },
            content: { type: 'string' },
            metadata: { type: 'object' },
            toolAction: { type: 'object' },
            toolDetail: { type: 'object' },
          },
        },
        IssueLogsResponse: {
          type: 'object',
          properties: {
            issue: { $ref: '#/components/schemas/Issue' },
            logs: { type: 'array', items: { $ref: '#/components/schemas/NormalizedLogEntry' } },
            hasMore: { type: 'boolean' },
            nextCursor: { type: 'string', nullable: true },
          },
        },
        IssueChangesResponse: {
          type: 'object',
          properties: {
            root: { type: 'string' },
            gitRepo: { type: 'boolean' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  status: { type: 'string' },
                  type: { type: 'string', enum: ['modified', 'added', 'deleted', 'renamed', 'untracked', 'unknown'] },
                  staged: { type: 'boolean' },
                  unstaged: { type: 'boolean' },
                  additions: { type: 'integer' },
                  deletions: { type: 'integer' },
                },
              },
            },
            additions: { type: 'integer' },
            deletions: { type: 'integer' },
            timedOut: { type: 'boolean' },
          },
        },
        CategorizedCommands: {
          type: 'object',
          properties: {
            commands: { type: 'array', items: { type: 'string' } },
            agents: { type: 'array', items: { type: 'string' } },
            plugins: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } } } },
          },
        },

        // ── Engines ────────────────────────────────
        EngineAvailability: {
          type: 'object',
          properties: {
            engineType: { type: 'string' },
            installed: { type: 'boolean' },
            executable: { type: 'boolean' },
            version: { type: 'string' },
            binaryPath: { type: 'string' },
            authStatus: { type: 'string', enum: ['authenticated', 'unauthenticated', 'unknown'] },
            error: { type: 'string' },
          },
        },
        EngineModel: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            isDefault: { type: 'boolean' },
          },
        },
        EngineDiscoveryResult: {
          type: 'object',
          properties: {
            engines: { type: 'array', items: { $ref: '#/components/schemas/EngineAvailability' } },
            models: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/EngineModel' } } },
          },
        },
        EngineProfile: {
          type: 'object',
          properties: {
            engineType: { type: 'string' },
            name: { type: 'string' },
            baseCommand: { type: 'string' },
            protocol: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            defaultModel: { type: 'string' },
            permissionPolicy: { type: 'string' },
          },
        },
        EngineSettings: {
          type: 'object',
          properties: {
            defaultEngine: { type: 'string', nullable: true },
            engines: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  defaultModel: { type: 'string' },
                  hiddenModels: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        ProbeResult: {
          type: 'object',
          properties: {
            engines: { type: 'array', items: { $ref: '#/components/schemas/EngineAvailability' } },
            models: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/EngineModel' } } },
            duration: { type: 'number' },
          },
        },

        // ── Cron ───────────────────────────────────
        CronJob: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            cron: { type: 'string' },
            taskType: { type: 'string' },
            taskConfig: { type: 'object' },
            enabled: { type: 'boolean' },
            lastRun: { type: 'object', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateCronJob: {
          type: 'object',
          required: ['name', 'cron', 'action'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            cron: { type: 'string', description: 'Cron expression' },
            action: { type: 'string', description: 'Action identifier' },
            config: { type: 'object', additionalProperties: true },
          },
        },

        // ── Processes ──────────────────────────────
        ProcessInfo: {
          type: 'object',
          properties: {
            executionId: { type: 'string' },
            issueId: { type: 'string' },
            issueTitle: { type: 'string' },
            issueNumber: { type: 'integer' },
            projectId: { type: 'string' },
            projectAlias: { type: 'string' },
            projectName: { type: 'string' },
            engineType: { type: 'string' },
            processState: { type: 'string' },
            model: { type: 'string', nullable: true },
            startedAt: { type: 'string', format: 'date-time' },
            turnInFlight: { type: 'boolean' },
            spawnCommand: { type: 'string', nullable: true },
            lastIdleAt: { type: 'string', format: 'date-time', nullable: true },
            pid: { type: 'integer', nullable: true },
          },
        },

        // ── Notes ──────────────────────────────────
        Note: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            isPinned: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ── Settings ───────────────────────────────
        WriteFilterRule: {
          type: 'object',
          required: ['id', 'type', 'match', 'enabled'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', const: 'tool-name' },
            match: { type: 'string' },
            enabled: { type: 'boolean' },
          },
        },

        // ── Webhooks ───────────────────────────────
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            channel: { type: 'string', enum: ['webhook', 'telegram'] },
            url: { type: 'string' },
            secret: { type: 'string', nullable: true, description: 'Masked in responses' },
            events: { type: 'array', items: { type: 'string' } },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateWebhook: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            channel: { type: 'string', enum: ['webhook', 'telegram'], default: 'webhook' },
            url: { type: 'string', description: 'Webhook URL or Telegram chat ID' },
            secret: { type: 'string', maxLength: 256, description: 'HMAC secret or Telegram bot token' },
            events: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'string',
                enum: [
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
                ],
              },
            },
            isActive: { type: 'boolean' },
          },
        },
        UpdateWebhook: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            secret: { type: 'string', nullable: true },
            events: { type: 'array', items: { type: 'string' } },
            isActive: { type: 'boolean' },
          },
        },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            webhookId: { type: 'string' },
            event: { type: 'string' },
            payload: { type: 'string' },
            statusCode: { type: 'integer', nullable: true },
            response: { type: 'string', nullable: true },
            success: { type: 'boolean' },
            duration: { type: 'integer', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }
}

// ── Helpers ──────────────────────────────────────────────

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` }
}

function projectIdParam() {
  return { name: 'projectId', in: 'path' as const, required: true, schema: { type: 'string' }, description: 'Project ID or alias' }
}

function issueIdParam() {
  return { name: 'issueId', in: 'path' as const, required: true, schema: { type: 'string' }, description: 'Issue ID' }
}

function engineTypeParam() {
  return { name: 'engineType', in: 'path' as const, required: true, schema: { type: 'string' }, description: 'Engine type (claude-code, codex, acp, acp:*)' }
}

function jsonResponse(description: string, schema: Record<string, unknown>) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', const: true },
            data: schema,
          },
        },
      },
    },
  }
}

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { 'application/json': { schema } },
  }
}
