# Architecture

## Overview

BKD is a Kanban application for managing autonomous AI coding agents. Issues on the board are assigned to CLI-based AI engines (Claude Code, Codex, Gemini CLI) that execute in the user's workspace. The system handles process orchestration, streaming log aggregation, real-time SSE updates, cron scheduling, and self-upgrades.

**Deployment assumption:** BKD is currently designed as a single-user application. The backend, frontend, SSE event model, workspace access model, and settings surface assume one trusted operator per deployment. It is not currently designed as a multi-tenant or per-project-isolated system for mutually untrusted users. This assumption is especially important for features such as the global SSE stream, shared process visibility, workspace browsing, and settings management. If BKD is extended to support multi-user deployments in the future, server-side authorization boundaries will need to be added explicitly.

**Bun Workspaces monorepo** with four packages:

| Package | Name | Purpose |
|---------|------|---------|
| `apps/api` | `@bkd/api` | Bun/Hono backend server |
| `apps/frontend` | `@bkd/frontend` | React/Vite frontend SPA |
| `packages/shared` | `@bkd/shared` | Shared TypeScript types |
| `packages/tsconfig` | `@bkd/tsconfig` | Shared TS configs (base, hono, react, utils) |

**Dependency flow:** `@bkd/api` and `@bkd/frontend` both depend on `@bkd/shared`. Shared versions managed via Catalogs in root `package.json`.

---

## Backend (`apps/api/src/`)

### Runtime & Server

- **Runtime**: Bun with `Bun.serve()` (`idleTimeout: 60`, WebSocket support)
- **Router**: Hono mounted at `/api` via `app.ts`
- **Logging**: pino (structured HTTP request logging)
- **Caching**: In-process LRU+TTL Map (max 500 entries, 5-min sweep)
- **Static serving**: three modes — embedded (compiled binary), `APP_DIR/public/` (package), `apps/frontend/dist/` (dev)

### Middleware (`app.ts`)

1. `secureHeaders()` — security response headers
2. `compress()` — gzip/deflate (skipped for SSE routes)
3. `httpLogger()` — pino-based request logging
4. `authMiddleware()` — protects `/api/*` when `AUTH_ENABLED` (OIDC/token)
5. Global error handler — returns `{ success: false, error }` envelope
6. `@hono/zod-validator` — Zod schema validation on all POST/PATCH routes

### Database (`db/`)

SQLite via `bun:sqlite` + Drizzle ORM. WAL mode, foreign keys, 64 MB cache, 256 MB mmap, `busy_timeout=15000`. Migrations auto-apply on startup.

**ID conventions:** `shortId()` (8-char nanoid) for projects/issues; `id()` (ULID) for logs/attachments/tool calls.

**Tables:**

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `projects` | `id`, `name`, `alias` (unique), `directory`, `repositoryUrl`, `systemPrompt`, `envVars` | Top-level container; supports archive |
| `issues` | `id`, `projectId`, `statusId`, `issueNumber`, `title`, `tags`, `parentIssueId`, `useWorktree`, `isPinned`, `keepAlive`, `engineType`, `sessionStatus`, `model`, `externalSessionId`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd` | Core entity; CHECK constraint on status |
| `issueLogs` | `id` (ULID), `issueId`, `turnIndex`, `entryIndex`, `entryType`, `content`, `metadata`, `visible` | Conversation log entries |
| `issuesLogsToolsCall` | `id` (ULID), `logId`, `issueId`, `toolName`, `toolCallId`, `kind`, `isResult`, `raw` | Tool action detail records |
| `attachments` | `id` (ULID), `issueId`, `logId`, `originalName`, `storedName`, `mimeType`, `size` | File uploads |
| `appSettings` | `key` (PK), `value` | Key-value store for server config |
| `notes` | `id` (ULID), `title`, `content`, `isPinned` | User notes |
| `webhooks` | `id` (ULID), `channel`, `url`, `secret`, `events`, `isActive` | Webhook endpoints |
| `webhookDeliveries` | `id`, `webhookId`, `dedupKey`, `statusCode`, `success`, `duration` | Delivery audit trail |
| `cronJobs` | `id`, `name`, `cron`, `taskType`, `taskConfig`, `enabled` | Scheduled jobs |
| `cronJobLogs` | `id`, `jobId`, `status`, `result`, `error`, `durationMs` | Job execution logs |

All tables share `commonFields`: `createdAt`, `updatedAt`, `isDeleted` (soft delete).

### Statuses (`config.ts`)

Hardcoded constants — no DB table:

| Status | Color | Sort |
|--------|-------|------|
| `todo` | `#6b7280` | 0 |
| `working` | `#3b82f6` | 1 |
| `review` | `#f59e0b` | 2 |
| `done` | `#22c55e` | 3 |

### API Routes (`routes/`)

**Issue routes** (all project-scoped under `/api/projects/:projectId/`):

| Route | Methods | File | Description |
|-------|---------|------|-------------|
| `/api/projects` | GET, POST | `projects.ts` | List/create projects |
| `/api/projects/:id` | GET, PATCH, DELETE | `projects.ts` | Get/update/soft-delete project |
| `/api/.../issues` | GET, POST | `issues/query.ts`, `create.ts` | List/create issues |
| `/api/.../issues/bulk` | PATCH | `issues/create.ts` | Bulk update status/sort |
| `/api/.../issues/:id` | GET, PATCH, DELETE | `issues/query.ts`, `update.ts`, `delete.ts` | Single issue CRUD |
| `/api/.../issues/:id/execute` | POST | `issues/command.ts` | Start AI engine execution |
| `/api/.../issues/:id/follow-up` | POST | `issues/message.ts` | Follow-up to active session |
| `/api/.../issues/:id/restart` | POST | `issues/command.ts` | Restart session |
| `/api/.../issues/:id/cancel` | POST | `issues/command.ts` | Cancel active session |
| `/api/.../issues/:id/messages` | POST | `issues/message.ts` | Queue pending message |
| `/api/.../issues/:id/logs` | GET | `issues/logs.ts` | Paginated logs (cursor-based) |
| `/api/.../issues/:id/logs/filter/*` | GET | `issues/logs.ts` | Filtered logs (path key/value) |
| `/api/.../issues/:id/attachments` | GET, POST | `issues/attachments.ts` | File upload (multipart) |
| `/api/.../issues/:id/changes` | GET | `issues/changes.ts` | Git diff stats |
| `/api/.../issues/:id/duplicate` | POST | `issues/duplicate.ts` | Clone issue |
| `/api/.../issues/:id/export` | GET | `issues/export.ts` | Export as JSON/TXT |
| `/api/.../issues/:id/title/generate` | POST | `issues/title.ts` | AI-generated title |

**System routes:**

| Route | Methods | File | Description |
|-------|---------|------|-------------|
| `/api/health` | GET | `api.ts` | DB health + version |
| `/api/engines/*` | GET, POST | `engines.ts` | Engine discovery, models, probe |
| `/api/events` | GET | `events.ts` | Global SSE endpoint |
| `/api/settings/*` | GET, PATCH | `settings/` | App settings (8 sub-routes) |
| `/api/terminal/ws` | WS | `terminal.ts` | WebSocket terminal |
| `/api/files/*` | GET, POST | `files.ts` | File operations, chunked upload |
| `/api/filesystem/*` | GET | `filesystem.ts` | Directory listing |
| `/api/git/*` | GET | `git.ts` | Git status, diff |
| `/api/processes/*` | GET, DELETE | `processes.ts` | Active engine processes |
| `/api/worktrees/*` | GET, DELETE | `worktrees.ts` | Worktree management |
| `/api/cron/*` | GET, POST, PATCH, DELETE | `cron.ts` | Cron job management |
| `/api/notes/*` | GET, POST, PATCH, DELETE | `notes.ts` | Notes CRUD |
| `/api/mcp/*` | GET, POST | `mcp.ts` | MCP server routes |

### Engine System (`engines/`)

The most complex subsystem — bridges API routes and CLI-based AI agents.

#### Engine Types & Protocols

| Engine | Protocol | CLI | Behavior |
|--------|----------|-----|----------|
| `claude-code` | `stream-json` | `claude` binary | Streaming JSON over stdout; process exits after each turn |
| `codex` | `json-rpc` | `codex app-server` | JSONL JSON-RPC over stdio; process **stays alive** between turns |
| `acp` | `acp` | Selected by `model` prefix | ACP protocol; routes to Gemini/Codex/Claude by `acp:<agent>:<model>` |

Each executor implements `EngineExecutor`: `spawn`, `spawnFollowUp`, `cancel`, `getAvailability`, `getModels`, `normalizeLog`.

#### Directory Structure

```
engines/
├── types.ts                    — Core types, EngineExecutor interface
├── process-manager.ts          — Generic subprocess lifecycle manager
├── startup-probe.ts            — Engine discovery (3-tier cache)
├── reconciler.ts               — Stale session cleanup safety net
├── spawn.ts                    — node:child_process wrapper
├── engine-store.ts             — Executor registry
├── executors/
│   ├── claude/
│   │   ├── executor.ts         — Main Claude Code executor
│   │   ├── protocol.ts         — Stream-JSON protocol handler
│   │   ├── normalizer.ts       — Log normalization
│   │   ├── normalizer-types.ts — Type definitions
│   │   └── normalizer-tool.ts  — Tool call parsing
│   ├── codex/
│   │   ├── executor.ts         — Codex executor (long-lived process)
│   │   ├── protocol.ts         — JSON-RPC protocol handler
│   │   └── normalizer.ts       — Log normalization (most complex)
│   ├── acp/
│   │   ├── executor.ts         — ACP executor
│   │   ├── protocol-handler.ts — ACP protocol logic
│   │   ├── normalizer.ts       — Log normalization
│   │   ├── transport.ts        — Subprocess/event bridge
│   │   ├── acp-client.ts       — ACP client facade
│   │   └── agents/             — Per-agent configs (gemini, codex, claude)
└── issue/
    ├── engine.ts               — IssueEngine singleton facade
    ├── orchestration/          — execute, follow-up, restart, cancel
    ├── lifecycle/              — spawn, completion, settlement
    ├── streams/                — Async stdout consumer, log classification
    ├── persistence/            — DB writes for logs + tool calls
    ├── pipeline/               — Token aggregation, failure detection, auto-title
    ├── state/                  — State machine actions
    ├── process/                — Per-issue lock (chained Promises)
    ├── store/                  — Execution store, message rebuilder
    └── utils/                  — Worktree, visibility, normalizer factory
```

#### Process Manager (`process-manager.ts`)

Generic `ProcessManager<TMeta>` for subprocess lifecycle:

- State machine: `spawning → running → completed/failed/cancelled`
- Groups processes by issue ID; supports `terminateGroup()`
- Graceful interrupt → SIGKILL after 5s timeout
- Auto-cleanup of terminal entries after 5 min; GC sweep every 10 min

#### Issue Engine Layer (`engines/issue/`)

`IssueEngine` singleton — orchestration facade between routes and executors:

```
Route handler → IssueEngine.executeIssue() → acquires per-issue lock
  → updates DB (sessionStatus='running') → executor.spawn() → ProcessManager.register()
  → consumeStream() (async generator over stdout) → persistence/ (DB) + events/ (SSE)
  → monitorCompletion() → settleIssue() (status → 'review')
```

#### State Axes

| Axis | Field | Values | Owner |
|------|-------|--------|-------|
| Board workflow | `issues.statusId` | `todo`, `working`, `review`, `done` | Routes + reconciler |
| Session lifecycle | `issues.sessionStatus` | `pending`, `running`, `completed`, `failed`, `cancelled` | IssueEngine |
| Subprocess | ProcessManager state | `spawning`, `running`, `completed`, `failed`, `cancelled` | ProcessManager |

#### Concurrency Control

- **Per-issue mutex** (`withIssueLock`): Promise-chain lock keyed by `issueId`, queue depth cap (10), acquire timeout (30s), execution timeout (120s)
- **Probe dedup** (`startup-probe.ts`): `probeInFlight` ensures concurrent callers share one probe

#### Reconciler (`reconciler.ts`)

Safety net for stale sessions:
- **Startup**: marks `running`/`pending` sessions as `failed`; moves orphaned `working` issues to `review`
- **Periodic**: every 60s
- **Event-driven**: 1s after each issue settlement

#### Engine Discovery (`startup-probe.ts`)

Three-tier caching: memory (10 min) → DB (`appSettings`) → live probe (15s timeout, parallel).

### Cron System (`cron/`)

Powered by `cronbake` scheduler:

- **Built-in jobs**: `upload-cleanup` (hourly), `log-cleanup`, `worktree-cleanup` (30 min)
- **Issue jobs**: `issue-execute`, `issue-follow-up`, `issue-close`, `issue-check-status`
- Tables: `cronJobs` + `cronJobLogs`
- MCP integration: cron jobs exposed as MCP tools for AI agents

### Event System (`events/`)

**SSE endpoint** (`GET /api/events`) — single global stream via Hono `streamSSE`:

**Single-user assumption:** `/api/events` is intentionally implemented as one global event stream with client-side filtering. This is an explicit tradeoff under the current single-user deployment model, where all visible issue activity belongs to the same trusted operator. It should not be interpreted as a multi-user authorization boundary.

- Event types: `log`, `state`, `done`, `issue-updated`, `changes-summary`, `heartbeat` (15s)
- Subscribes to: `IssueEngine.onLog`, `.onStateChange`, `.onIssueSettled`, `onIssueUpdated`, `onChangesSummary`

**`changes-summary.ts`**: runs `git status/diff` after each issue settles; pushes file change stats via SSE.

### Self-Upgrade System (`upgrade/`)

Polls GitHub Releases (`repos/bkhq/bkd/releases/latest`) every 1h:

- **Binary mode**: downloads compiled binary, spawns on restart
- **Package mode**: downloads `.tar.gz`, extracts to `data/app/v{version}/`
- Mandatory SHA-256 checksum verification
- Downloads to `data/updates/` with `.tmp` suffix, atomic rename

### Webhook System (`webhooks/`)

- Channels: `webhook` (HTTP POST) and `telegram` (bot API)
- Events: issue status changes, session state changes
- Delivery audit trail in `webhookDeliveries` table
- Deduplication via `dedupKey`

### MCP Server (`mcp/`)

Model Context Protocol server exposing BKD operations as tools:

- Project/issue CRUD, execute/follow-up/cancel
- Engine listing, process management
- Cron job management

---

## Frontend (`apps/frontend/src/`)

### Stack

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui components
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Server state**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **Local UI state**: Zustand stores
- **Drag & drop**: @atlaskit/pragmatic-drag-and-drop
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **Terminal**: xterm.js 6.0 + WebSocket
- **i18n**: i18next + react-i18next (Chinese default, English)
- **Path alias**: `@/*` → `src/*`
- **Dev proxy**: Vite forwards `/api/*` to `localhost:3010`

### Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | `HomePage` | Project dashboard |
| `/projects/:projectId` | `KanbanPage` | Kanban board with drag-and-drop |
| `/projects/:projectId/issues[/:issueId]` | `IssueDetailPage` | Three-panel: list + chat + diff |
| `/review[/:projectAlias/:issueId]` | `ReviewPage` | Review queue |
| `/terminal` | `TerminalPage` | Full-page terminal |
| `/cron` | `CronPage` | Cron job management |
| `/login[/callback]` | `LoginPage` | OAuth/token login |

Four global drawers (lazy-mounted): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`, `NotesDrawer`.

### Component Architecture

```
components/
├── ui/              ← shadcn/ui primitives (25+ components)
├── kanban/          ← Board: columns, cards, sidebar, create dialog, header
├── issue-detail/    ← Chat area, log entries, tool items, diff panel, markdown
├── files/           ← File browser: breadcrumbs, directory listing, file viewer
├── terminal/        ← xterm.js WebSocket terminal
├── processes/       ← Active engine process list
├── notes/           ← Notes drawer and editor
└── settings/        ← Webhook, cleanup, upgrade settings
```

### State Management

**React Query** — all server state. Query key factory (`queryKeys`) covers projects, issues, changes, engines, settings, cron, etc.

**Zustand stores** — pure client UI state:

| Store | State |
|-------|-------|
| `board-store` | Grouped items by status, `isDragging` (pauses server sync) |
| `panel-store` | Side panel open/closed, width, create dialog |
| `view-mode-store` | Kanban/list toggle (persisted in localStorage) |
| `terminal-store` | Terminal drawer state |
| `terminal-session-store` | xterm.js instance, WebSocket, session ID |
| `file-browser-store` | File browser drawer, current path |
| `process-manager-store` | Process manager drawer |
| `notes-store` | Notes drawer state |
| `server-store` | Server name, URL |

### Real-Time Data Flow

```
Server (IssueEngine)
    ↓
SSE /api/events
    ↓
EventBus singleton (lib/event-bus.ts)
    ├── log events     → useIssueStream() → liveLogs (capped 500, ULID dedup)
    ├── state events   → sessionStatus update
    ├── done events    → React Query invalidation
    ├── issue-updated  → projects/issues query invalidation
    └── changes-summary → useChangesSummary()
```

**EventBus**: single `EventSource` with exponential backoff reconnection and 35s heartbeat watchdog. On reconnect: invalidates all queries.

**useIssueStream**: fetches historical logs via HTTP, subscribes to SSE for real-time. Two arrays: `liveLogs` (capped 500) and `olderLogs` (pagination). ULID dedup.

### API Client (`lib/kanban-api.ts`)

Typed async functions wrapping all backend endpoints. Internal helpers (`get`, `post`, `patch`, `del`, `postFormData`) parse `{ success, data, error }` envelope. Auth token included when present; 401 triggers redirect.

---

## Shared Types (`packages/shared/`)

Single source of truth consumed by both backend and frontend:

- **Domain**: `Project`, `Issue`, `EngineType`, `SessionStatus`, `Priority`, `PermissionMode`, `BusyAction`
- **Logs**: `NormalizedLogEntry`, `LogEntryType`, `ChatMessage` (8 variants), `ToolAction`, `ToolDetail`
- **Engine**: `EngineAvailability`, `EngineModel`, `EngineDiscoveryResult`, `EngineProfile`, `ProbeResult`
- **API**: `ApiResponse<T>`, `ExecuteIssueRequest`, `IssueLogsResponse`, `IssueChangesResponse`
- **Files**: `FileEntry`, `DirectoryListing`, `FileContent`
- **Processes**: `ProcessInfo`, `ProjectProcessesResponse`

Frontend re-exports via `types/kanban.ts`.

---

## Build & Distribution

### Three Distribution Modes

**1. Full binary** (`bun run compile`):
- Builds Vite frontend → embeds assets into `static-assets.ts`
- Embeds Drizzle migrations into `embedded-migrations.ts`
- Compiles to standalone binary (~105 MB) via `bun build --compile`
- SHA-256 checksum generated

**2. Launcher binary** (`bun run compile:launcher`):
- Compiles only `scripts/launcher.ts` (~90 MB)
- At runtime: reads `data/app/version.json`, loads server from `data/app/v{version}/`
- Auto-downloads latest release if no local version; URL allowlist, 50 MB cap, SHA-256 verify

**3. App package** (`bun run package`):
- Bundles server → `server.js`, creates `.tar.gz` (~1 MB)
- Contains `server.js`, `public/`, `migrations/`, `version.json`
- Used with launcher binary for incremental updates

### CI/CD (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PRs to `main` | Lint + format check |
| `release.yml` | `v*` tags | Build full binary (3 platforms) + app package → GitHub Release |
| `launcher.yml` | Manual dispatch | Build launcher binary (3 platforms) → `launcher-v1` pre-release |

Platforms: `linux-x64`, `linux-arm64`, `darwin-arm64`.

### Database Migrations

16 migrations in `apps/api/drizzle/` (0000–0015). Auto-applied on startup. Sources: filesystem, `APP_DIR/migrations/`, or embedded (compiled binary).

---

## Key Architectural Patterns

1. **API response envelope**: `{ success: true, data: T } | { success: false, error: string }`
2. **Soft deletion**: all entities use `isDeleted` flag, never hard-deleted
3. **Per-issue operation lock**: chained Promises prevent concurrent execute/follow-up/restart
4. **Optimistic UI**: drag-and-drop uses board store for immediate feedback; sync pauses during drag
5. **Three-tier engine discovery cache**: memory → DB → live probe
6. **Event-driven invalidation**: SSE events trigger targeted React Query cache invalidation
7. **Pending message coalescence**: messages queued while AI is busy merge into single follow-up on exit
8. **Reconciliation**: startup + periodic + event-driven safety net for orphaned sessions
9. **Immutable session IDs**: `externalSessionId` enables session continuity across follow-ups
10. **Auto-retry**: failed sessions retry up to max limit

---

## Deployment Constraints

- **Single instance**: in-memory state (process manager, caches) does not replicate
- **Stateful**: subprocess tracking requires stable PID space
- **SQLite**: excellent for single-machine, not horizontally scalable for writes
- **Long-lived processes**: Codex engine keeps processes alive between turns

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono |
| Database | SQLite + Drizzle ORM |
| Frontend | React 19 + Vite 7 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Drag & Drop | @atlaskit/pragmatic-drag-and-drop |
| Terminal | xterm.js 6.0 |
| Syntax | Shiki 4.0 |
| Cron | cronbake |
| i18n | i18next |
| Linting | @antfu/eslint-config |
| AI Engines | Claude Code, OpenAI Codex, ACP (Gemini/Codex/Claude) |
| MCP | @modelcontextprotocol/sdk |
