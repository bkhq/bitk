# PLAN-029 Integrate cronbake cron module with MCP interface

- **status**: completed
- **createdAt**: 2026-03-23 11:20
- **approvedAt**: 2026-03-23 11:20
- **relatedTask**: CRON-001

## Context

Current background jobs use raw `setInterval` in `apps/api/src/jobs/`:
- `upload-cleanup.ts`: removes files >7 days old, every 1 hour
- `worktree-cleanup.ts`: removes worktrees for done issues >1 day old, every 30 min

Each returns a stop function, manually wired into `index.ts` startup/shutdown. No unified scheduling, no execution history, no dynamic job management.

MCP server at `apps/api/src/mcp/server.ts` has 15+ tools using `server.registerTool()` + Zod schema pattern.

## Proposal

### 1. Database (2 new tables)

**`cron_jobs`** — job definitions:
- `id` (nanoid 8-char), `name` (unique), `cron` (expression), `task_type`, `task_config` (JSON)
- `enabled` (boolean), `created_at`, `updated_at`, `is_deleted`

**`cron_job_logs`** — execution history:
- `id` (ULID), `job_id` (FK), `started_at`, `finished_at`, `duration_ms`
- `status` ('success'|'failed'), `result` (text), `error` (text)

### 2. Cron module (`apps/api/src/cron/`)

```
cron/
├── index.ts              # Baker singleton, startCron()/stopCron(), syncJob()
├── registry.ts           # builtin task handler registry
├── executor.ts           # wraps task execution with logging to cron_job_logs
├── tasks/
│   ├── upload-cleanup.ts
│   └── worktree-cleanup.ts
└── mcp.ts                # 6 MCP tool registrations
```

### 3. MCP tools (6)

| Tool | Input | Description |
|------|-------|-------------|
| `cron-list` | `enabled?` | List all jobs with status and last run info |
| `cron-create` | `name, cron, taskType, taskConfig` | Create and register new job |
| `cron-delete` | `jobId\|name` | Soft-delete and unregister job |
| `cron-trigger` | `jobId\|name` | Execute job immediately |
| `cron-pause` / `cron-resume` | `jobId\|name` | Toggle enabled state |
| `cron-get-logs` | `jobId\|name, status?, limit?, cursor?` | View execution logs with pagination |

### 4. Startup/shutdown changes

Replace multiple stop functions with single `startCron()`/`stopCron()` pair in `index.ts`.

## Risks

- cronbake v0.4.0 is relatively new; mitigated by zero dependencies and simple internals
- Baker state is in-memory; DB is source of truth, sync on create/delete/restart

## Scope

- New: 6 files (cron module) + 1 migration + schema update
- Modified: index.ts, mcp/server.ts
- Deleted: jobs/upload-cleanup.ts, jobs/worktree-cleanup.ts

## Alternatives

1. Keep setInterval + add MCP wrapper — simpler but no cron expressions, history, or unified management
2. Custom scheduler — unnecessary given cronbake's lightweight design

## Annotations

(none)
