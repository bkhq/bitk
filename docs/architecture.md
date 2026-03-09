# Architecture

## Overview

BitK is a Kanban application for managing AI coding agents. Issues on the board are assigned to CLI-based AI engines (Claude Code, Codex, Gemini) that execute autonomously in the user's workspace.

The project is a **Bun Workspaces monorepo** with three packages:

| Package           | Name            | Purpose                 |
| ----------------- | --------------- | ----------------------- |
| `apps/api`        | `@bkd/api`      | Bun/Hono backend server |
| `apps/frontend`   | `@bkd/frontend` | React/Vite frontend     |
| `packages/shared` | `@bkd/shared`   | Shared TypeScript types |

Supporting packages: `packages/tsconfig` (shared TS configs: `base`, `hono`, `react`, `utils`).

---

## Backend (`apps/api/src/`)

### Runtime & Server

- **Runtime**: Bun with `Bun.serve()` (`idleTimeout: 60`, WebSocket support)
- **Router**: Hono mounted at `/api` via `app.ts`
- **Logging**: pino (structured HTTP request logging via custom middleware)
- **Static serving**: three modes:
  - **Compiled mode**: assets embedded in binary via `static-assets.ts`
  - **Package mode**: files from `APP_DIR/public/`
  - **Dev mode**: files from `apps/frontend/dist/`

### Middleware (`app.ts`)

1. `secureHeaders()` — security response headers
2. `compress()` — gzip/deflate (skipped for SSE routes)
3. `httpLogger()` — pino-based request logging
4. `@hono/zod-validator` — Zod schema validation on all POST/PATCH routes
5. Global error handler — returns `{ success: false, error }` envelope

### Database (`db/`)

SQLite via `bun:sqlite` + Drizzle ORM. Configured with WAL mode, foreign keys, 64 MB cache, 256 MB mmap, `busy_timeout=15000`.

Migrations auto-apply on startup from filesystem, `APP_DIR/migrations/`, or embedded (compiled binary).

**ID conventions:**

- `shortId()` — 8-char nanoid (projects, issues)
- `id()` — ULID (logs, attachments, tool calls)

**Tables:**

| Table                 | Key Fields                                                                                                                                                                                       | Notes                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `projects`            | `id`, `name`, `alias` (unique), `directory`, `repositoryUrl`                                                                                                                                     | Top-level container                            |
| `issues`              | `id`, `projectId`, `statusId`, `issueNumber`, `title`, `priority`, `sortOrder`, `parentIssueId`, `useWorktree`, `engineType`, `sessionStatus`, `prompt`, `externalSessionId`, `model`, `devMode` | Core entity; check constraint on status values |
| `issueLogs`           | `id` (ULID), `issueId`, `turnIndex`, `entryIndex`, `entryType`, `content`, `metadata`                                                                                                            | AI conversation log entries                    |
| `issuesLogsToolsCall` | `id` (ULID), `logId`, `issueId`, `toolName`, `toolCallId`, `kind`, `isResult`, `raw`                                                                                                             | Tool action detail records                     |
| `attachments`         | `id` (ULID), `issueId`, `logId`, `originalName`, `storedName`, `mimeType`, `size`, `storagePath`                                                                                                 | File uploads                                   |
| `appSettings`         | `key` (PK), `value`                                                                                                                                                                              | Key-value store for server settings            |

All tables share `commonFields`: `createdAt`, `updatedAt`, `isDeleted` (soft delete).

**Caching** (`cache.ts`): in-process LRU + TTL cache (Map-based, max 500 entries, 5-minute sweep). Used by DB helpers for projects, settings, and engine discovery.

**Settings** stored in `appSettings`:

- `workspace:defaultPath`, `defaultEngine`, `engine:<type>:defaultModel`
- `probe:engines`, `probe:models` (persisted engine discovery)
- `engine:slashCommands:<type>`, `upgrade:enabled`, `upgrade:lastCheckResult`
- `writeFilter:rules`, `worktree:autoCleanup`

### Statuses (`config.ts`)

Hardcoded constants — no DB table:

| Status    | Color     | Sort |
| --------- | --------- | ---- |
| `todo`    | `#6b7280` | 0    |
| `working` | `#3b82f6` | 1    |
| `review`  | `#f59e0b` | 2    |
| `done`    | `#22c55e` | 3    |

### API Routes (`routes/`)

**Core routes** (all issue routes scoped under `/api/projects/:projectId/`):

| Route                                | Methods            | File                                                      | Description                      |
| ------------------------------------ | ------------------ | --------------------------------------------------------- | -------------------------------- |
| `/api/projects`                      | GET, POST          | `projects.ts`                                             | List/create projects             |
| `/api/projects/:id`                  | GET, PATCH, DELETE | `projects.ts`                                             | Get/update/soft-delete project   |
| `/api/.../issues`                    | GET, POST          | `issues/query.ts`, `issues/create.ts`                     | List/create issues               |
| `/api/.../issues/bulk`               | PATCH              | `issues/create.ts`                                        | Bulk update status/sort/priority |
| `/api/.../issues/:id`                | GET, PATCH, DELETE | `issues/query.ts`, `issues/update.ts`, `issues/delete.ts` | Single issue CRUD                |
| `/api/.../issues/:id/execute`        | POST               | `issues/command.ts`                                       | Start AI engine execution        |
| `/api/.../issues/:id/follow-up`      | POST               | `issues/message.ts`                                       | Follow-up to active session      |
| `/api/.../issues/:id/restart`        | POST               | `issues/command.ts`                                       | Restart session                  |
| `/api/.../issues/:id/cancel`         | POST               | `issues/command.ts`                                       | Cancel active session            |
| `/api/.../issues/:id/messages`       | POST               | `issues/message.ts`                                       | Queue pending message            |
| `/api/.../issues/:id/logs`           | GET                | `issues/logs.ts`                                          | Paginated logs (cursor-based)    |
| `/api/.../issues/:id/attachments`    | GET, POST          | `issues/attachments.ts`                                   | File upload (multipart)          |
| `/api/.../issues/:id/changes`        | GET                | `issues/changes.ts`                                       | Git diff stats                   |
| `/api/.../issues/:id/title/generate` | POST               | `issues/title.ts`                                         | AI-generated title               |
| `/api/.../issues/:id/slash-commands` | GET                | `issues/command.ts`                                       | Slash commands for engine        |

**System routes:**

| Route                    | Methods                  | File            | Description                                     |
| ------------------------ | ------------------------ | --------------- | ----------------------------------------------- |
| `/api/health`            | GET                      | `api.ts`        | DB health + version                             |
| `/api/engines/available` | GET                      | `engines.ts`    | Engine discovery (cached)                       |
| `/api/engines/probe`     | POST                     | `engines.ts`    | Force live engine re-probe                      |
| `/api/engines/settings`  | GET                      | `engines.ts`    | Default engine + models                         |
| `/api/events`            | GET                      | `events.ts`     | Global SSE endpoint                             |
| `/api/settings/*`        | GET, PATCH, PUT          | `settings.ts`   | Workspace path, filter rules, worktree settings |
| `/api/upgrade/*`         | GET, POST, PATCH, DELETE | `upgrade.ts`    | Self-upgrade pipeline                           |
| `/api/terminal/ws`       | WS                       | `terminal.ts`   | WebSocket terminal                              |
| `/api/files/*`           | GET                      | `files.ts`      | File browsing                                   |
| `/api/filesystem/*`      | GET, POST                | `filesystem.ts` | Directory navigation                            |
| `/api/git/*`             | GET                      | `git.ts`        | Git operations                                  |
| `/api/processes/*`       | GET, DELETE              | `processes.ts`  | Active process management                       |
| `/api/worktrees/*`       | GET, DELETE              | `worktrees.ts`  | Worktree management                             |

### Engine System (`engines/`)

The most complex subsystem — bridges API routes and CLI-based AI agents.

#### Engine Types & Protocols

| Engine        | Protocol      | CLI                                                | Behavior                                                         |
| ------------- | ------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `claude-code` | `stream-json` | `claude` binary or `npx @anthropic-ai/claude-code` | Streaming JSON over stdout; process exits after each turn        |
| `codex`       | `json-rpc`    | `npx @openai/codex app-server`                     | JSONL JSON-RPC over stdio; process **stays alive** between turns |
| `gemini`      | `acp`         | `npx @google/gemini-cli`                           | ACP protocol                                                     |
| `echo`        | —             | —                                                  | Test/stub executor                                               |

Each executor implements `EngineExecutor`: `spawn`, `spawnFollowUp`, `cancel`, `getAvailability`, `getModels`, `normalizeLog`.

#### Process Manager (`process-manager.ts`)

Generic `ProcessManager<TMeta>` for any `Bun.spawn` subprocess:

- State machine: `spawning → running → completed/failed/cancelled`
- Groups processes by issue ID; supports `terminateGroup()`
- Graceful interrupt → SIGKILL after 5s timeout
- Auto-cleanup of terminal entries after 5 min; GC sweep every 10 min
- Event system: `onStateChange()`, `onExit()`

#### Issue Engine Layer (`engines/issue/`)

`IssueEngine` singleton — the orchestration facade between routes and executors:

```
routes/ → IssueEngine → executor.spawn() → ProcessManager → Bun.spawn()
                      ← streams/consumer ← stdout/stderr
                      → persistence/ → DB
                      → events/ → SSE
```

Key sub-modules:

- **`orchestration/`** — `execute.ts`, `follow-up.ts`, `restart.ts`, `cancel.ts`
- **`lifecycle/`** — Spawn (with session fallback), completion monitoring (auto-retry on failure, pending message coalescence), settlement
- **`streams/`** — Stdout consumption via async generator, log classification, stderr drain
- **`persistence/`** — Write normalized log entries + tool calls to DB
- **`state/`** — State machine actions on managed processes
- **`process/lock.ts`** — Per-issue serial lock via chained Promises (prevents concurrent ops on same issue)
- **`utils/worktree.ts`** — Git worktree management at `.worktrees/<projectId>/<issueId>/`
- **`engine-store.ts`** — Issue session field persistence

#### Reconciler (`reconciler.ts`)

Safety net for stale sessions:

- **Startup**: marks `running`/`pending` sessions as `failed`; moves orphaned `working` issues to `review`
- **Periodic**: runs every 60s to catch orphaned working issues
- **Event-driven**: reconciles 1s after each issue settlement

#### Engine Discovery (`startup-probe.ts`)

Three-tier caching: memory (10 min TTL) → DB (`appSettings`) → live probe (15s per-engine timeout). Each executor's `getAvailability()` and `getModels()` called in parallel.

### Process/State Orchestration Deep Dive

BitK runtime behavior depends on three coordinated state axes:

| Axis                 | Field / Source                   | Values                                                    | Owner                               |
| -------------------- | -------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Board workflow       | `issues.statusId`                | `todo`, `working`, `review`, `done`                       | Route layer + reconciler            |
| Session lifecycle    | `issues.sessionStatus`           | `pending`, `running`, `completed`, `failed`, `cancelled`  | IssueEngine orchestration/lifecycle |
| Subprocess lifecycle | `ProcessManager` in-memory state | `spawning`, `running`, `completed`, `failed`, `cancelled` | ProcessManager + executor events    |

#### Critical Transition Paths

1. **Enter `working`**
   - Trigger: issue create/update/bulk update.
   - Behavior: route marks `sessionStatus=pending`, then `executeIssue()` spawns process, transitions to `running`.
   - Guard: workspace path containment check prevents out-of-root execution.

2. **Follow-up while active**
   - Trigger: `/follow-up` or `/messages`.
   - Behavior: if process is active, prompt is queued in memory (`pendingInputs`) or persisted as DB pending message (route-level fallback).
   - Guard: `busyAction` (`queue`/`cancel`) controls whether current turn is interrupted.

3. **Turn/process completion**
   - Trigger: `monitorCompletion()` and `handleTurnCompletion()`.
   - Behavior: settles process/session state, optionally auto-flushes pending messages, then moves issue to `review` when terminal.
   - Guard: settlement races are avoided with `turnSettled` and per-issue lock.

4. **Deletion**
   - Trigger: delete issue/project APIs.
   - Behavior: force terminate active issue processes before soft delete.
   - Guard: termination failure aborts deletion (`500`) to avoid orphaned runtime state.

#### Concurrency Control

- **Per-issue mutex** (`withIssueLock`):
  - Promise-chain lock keyed by `issueId`
  - Queue depth cap (`MAX_QUEUE_DEPTH=10`)
  - Acquire timeout (`30s`) + execution timeout (`120s`)
  - Timeout path restores previous lock tail to avoid dropping a still-running lock chain
- **Probe dedup** (`startup-probe.ts`):
  - `probeInFlight` ensures concurrent discovery callers share one live probe
  - Result is persisted to both in-memory cache and DB settings

#### Failure Rollback Guarantees

- `executeIssue()` spawn failure: session reverted to `failed` and failure event emitted.
- `restartIssue()` spawn failure: session reverted/preserved to `failed` and failure event emitted.
- Pending flush failure: pending message metadata remains retryable (no premature dispatch).
- Auto-execute precondition failure (workspace boundary): issue transitions from `pending` to `failed`.

#### Deep Test Coverage Matrix

| Area                                 | Representative tests                                                                                                           | Intent                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Lock serialization and queue control | `apps/api/test/issue-lock.test.ts`                                                                                             | Verify per-issue mutual exclusion, queue-limit rejection, timeout cleanup behavior            |
| Probe dedup and cache semantics      | `apps/api/test/startup-probe.test.ts`                                                                                          | Verify concurrent callers trigger one live probe and cache/DB clearing re-enables fresh probe |
| Spawn failure rollback               | `apps/api/test/api-process-state-regression.test.ts`                                                                           | Ensure execute/restart failures do not leave stuck `pending/running` session state            |
| Pending-message loss prevention      | `apps/api/test/api-pending-messages.test.ts`                                                                                   | Ensure pending messages remain retryable on follow-up flush failure                           |
| Deletion safety                      | `apps/api/test/api-process-state-regression.test.ts`, `apps/api/test/api-issues.test.ts`, `apps/api/test/api-projects.test.ts` | Ensure terminate-before-delete semantics and soft-delete visibility constraints               |

### Event System (`events/`)

**SSE endpoint** (`GET /api/events`) — single global stream via Hono `streamSSE`:

- Event types: `log`, `state`, `done`, `issue-updated`, `changes-summary`, `heartbeat` (15s interval)
- Subscribes to: `IssueEngine.onLog`, `.onStateChange`, `.onIssueSettled`, `onIssueUpdated`, `onChangesSummary`
- Disconnect detection via `AbortSignal`

**`changes-summary.ts`**: runs `git status --porcelain` + `git diff --numstat` after each issue settles; pushes stats to SSE.

### Background Jobs (`jobs/`)

| Job                | Interval | Description                                                                           |
| ------------------ | -------- | ------------------------------------------------------------------------------------- |
| `upload-cleanup`   | 1 hour   | Deletes files in `data/uploads/` older than 7 days                                    |
| `worktree-cleanup` | 30 min   | Removes worktrees for `done` issues (>1 day); gated by `worktree:autoCleanup` setting |

### Self-Upgrade System (`upgrade/`)

Full self-upgrade pipeline polling GitHub Releases (`repos/bkhq/bkd/releases/latest`) every 1 hour:

- Detects platform asset suffix (`linux-x64`, `linux-arm64`, `darwin-arm64`)
- **Binary mode**: downloads compiled binary, spawns on restart
- **Package mode** (`APP_DIR != null`): downloads `.tar.gz`, extracts to `data/app/v{version}/`, writes `version.json`, re-execs launcher
- SHA-256 checksum verification mandatory (aborts if checksum unavailable)
- Downloads to `data/updates/` with `.tmp` suffix, atomic rename to final path
- Restart: graceful shutdown → `process.exit(0)` with detached child for new binary

---

## Frontend (`apps/frontend/src/`)

### Stack

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui components
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Server state**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **Local UI state**: Zustand stores
- **Drag & drop**: @dnd-kit/react
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **i18n**: i18next + react-i18next (Chinese default, English fallback)
- **Path alias**: `@/*` → `src/*`
- **Dev proxy**: Vite forwards `/api/*` to `localhost:3010`

### Routes

| Path                                   | Page              | Description                               |
| -------------------------------------- | ----------------- | ----------------------------------------- |
| `/`                                    | `HomePage`        | Project dashboard (grid of project cards) |
| `/projects/:projectId`                 | `KanbanPage`      | Kanban board with drag-and-drop columns   |
| `/projects/:projectId/issues`          | `IssueDetailPage` | Three-panel layout: list + chat + diff    |
| `/projects/:projectId/issues/:issueId` | `IssueDetailPage` | Specific issue chat view                  |
| `/terminal`                            | `TerminalPage`    | Full-page xterm.js terminal               |

Three global drawers (lazy-mounted): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`.

### Component Architecture

```
components/
├── ui/              ← shadcn/ui primitives (Button, Dialog, Badge, etc.)
├── kanban/          ← Kanban board: columns, cards, sidebar, create dialog
│   ├── AppSidebar.tsx       — Icon sidebar (projects, tools, settings)
│   ├── KanbanBoard.tsx      — DnD provider, syncs board store, renders columns
│   ├── KanbanColumn.tsx     — Droppable status column
│   ├── KanbanCard.tsx       — Sortable issue card
│   ├── KanbanHeader.tsx     — Search, filters, view-mode toggle
│   ├── IssuePanel.tsx       — Desktop side panel for selected issue
│   └── CreateIssueDialog.tsx — Issue creation modal
├── issue-detail/    ← Issue detail page: chat, diff, issue list
│   ├── ChatArea.tsx         — Title bar + ChatBody + DiffPanel
│   ├── ChatBody.tsx         — Log stream + metadata + input
│   ├── ChatInput.tsx        — Rich input (attachments, slash commands, model selector)
│   ├── SessionMessages.tsx  — Renders NormalizedLogEntry list
│   ├── LogEntry.tsx         — Single log entry renderer
│   ├── MarkdownContent.tsx  — Markdown + Shiki code blocks
│   ├── IssueListPanel.tsx   — Scrollable issue list
│   ├── IssueDetail.tsx      — Status/priority selectors, execution controls
│   ├── DiffPanel.tsx        — Resizable git diff viewer
│   └── SubIssueDialog.tsx   — Sub-issue creation
├── files/           ← File browser (breadcrumbs, list, viewer)
├── terminal/        ← xterm.js WebSocket terminal
└── processes/       ← Active engine process list
```

Top-level components: `AppSettingsDialog`, `CreateProjectDialog`, `ProjectSettingsDialog`, `DirectoryPicker`, `ErrorBoundary`, `EngineIcons`.

### State Management

**React Query** — all server state:

Query key factory (`queryKeys`) covers: `projects`, `issues`, `issueChanges`, `childIssues`, `slashCommands`, `engineAvailability`, `engineProfiles`, `engineSettings`, `projectFiles`, `projectProcesses`, `upgradeVersion`, `upgradeCheck`, etc.

Mutation hooks: `useCreateProject`, `useUpdateIssue`, `useBulkUpdateIssues` (optimistic + rollback), `useExecuteIssue`, `useFollowUpIssue`, `useCancelIssue`, `useRestartIssue`, `useAutoTitleIssue`, `useCheckForUpdates`, `useDownloadUpdate`, `useRestartWithUpgrade`, etc.

**Zustand stores** — pure client UI state:

| Store                    | State                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `board-store`            | `groupedItems` by status, `isDragging` (pauses server sync) |
| `panel-store`            | Side panel open/closed, width, create dialog state          |
| `view-mode-store`        | Kanban/list toggle (persisted in localStorage)              |
| `terminal-store`         | Terminal drawer open/minimized/fullscreen, width            |
| `terminal-session-store` | xterm.js instance, WebSocket, session ID                    |
| `file-browser-store`     | File browser drawer state, current path, `hideIgnored`      |
| `process-manager-store`  | Process manager drawer state                                |

### Real-Time Data Flow

```
Server (IssueEngine) → SSE /api/events → EventBus (singleton EventSource)
                                           ├── log events → useIssueStream → liveLogs state
                                           ├── state events → sessionStatus update
                                           ├── done events → React Query invalidation
                                           ├── issue-updated → projects query invalidation
                                           └── changes-summary → useChangesSummary
```

`EventBus` (`lib/event-bus.ts`): single `EventSource` to `/api/events` with exponential backoff reconnection and 35s heartbeat watchdog.

`useIssueStream`: the most complex hook — fetches historical logs via HTTP, subscribes to SSE for real-time updates. Manages two arrays (`liveLogs` capped at 500, `olderLogs` for pagination). ULID-based deduplication.

### API Client (`lib/kanban-api.ts`)

Plain object of typed async functions. Internal helpers (`get`, `post`, `patch`, `del`, `postFormData`) call `fetch`, parse `{ success, data, error }` envelope, throw on failure. Covers all endpoint groups: projects, issues, session commands, logs, engines, settings, upgrade, files, processes.

### i18n

Two locales: `zh` (Chinese, default), `en` (English). Language persisted in `localStorage`. Utility functions `tStatus()` and `tPriority()` translate status/priority names.

---

## Shared Types (`packages/shared/`)

Single source of truth for types consumed by both backend and frontend. Key exports:

- **Domain**: `Project`, `Issue`, `Priority`, `EngineType`, `PermissionMode`, `BusyAction`, `SessionStatus`
- **Logs**: `NormalizedLogEntry`, `LogEntryType`, `ToolAction`, `ToolDetail`, `CommandCategory`, `FileChange`
- **Engine**: `EngineAvailability`, `EngineModel`, `EngineDiscoveryResult`, `EngineProfile`, `EngineSettings`, `ProbeResult`
- **API**: `ApiResponse<T>`, `ExecuteIssueRequest`, `ExecuteIssueResponse`, `IssueLogsResponse`, `IssueChangesResponse`
- **Files**: `FileEntry`, `DirectoryListing`, `FileContent`, `FileListingResult`
- **Processes**: `ProcessInfo`, `ProjectProcessesResponse`

Frontend re-exports all types via `types/kanban.ts`.

---

## Build & Distribution

### Development

`bun run dev` starts both API (port 3010) and Vite (port 3000) in parallel. Vite proxies `/api/*` to the API server.

### Three Distribution Modes

**1. Full binary** (`bun run compile`):

- Builds Vite frontend
- Embeds all assets into `static-assets.ts` via `import ... with { type: "file" }`
- Embeds Drizzle migrations into `embedded-migrations.ts`
- Compiles to standalone binary (~105 MB) via `bun build --compile`
- SHA-256 checksum generated

**2. Launcher binary** (`bun run compile:launcher`):

- Compiles only `scripts/launcher.ts` (~90 MB)
- At runtime: reads `data/app/version.json`, loads server from `data/app/v{version}/`
- Auto-downloads latest release if no local version exists
- Security: URL allowlist, 50 MB cap, mandatory SHA-256 verification

**3. App package** (`bun run package`):

- Bundles server via `bun build` → `server.js`
- Creates `.tar.gz` (~1 MB) containing `server.js`, `public/`, `migrations/`, `version.json`
- Used with launcher binary for incremental updates

### CI/CD (`.github/workflows/`)

| Workflow       | Trigger         | Purpose                                                         |
| -------------- | --------------- | --------------------------------------------------------------- |
| `ci.yml`       | PRs to `main`   | Lint + format check (no test execution)                         |
| `release.yml`  | `v*` tags       | Build full binary (3 platforms) + app package → GitHub Release  |
| `launcher.yml` | Manual dispatch | Build launcher binary (3 platforms) → `launcher-v1` pre-release |

Release platforms: `linux-x64`, `linux-arm64`, `darwin-arm64`. All builds include SHA-256 checksum verification.

---

## Tooling

- **Linting/Formatting**: ESLint (`eslint.config.js`) + Prettier (`.prettierrc`) — no semicolons, single quotes, 2-space indent
- **Frontend tests**: vitest + @testing-library/react
- **Backend tests**: `bun:test` with preload for isolated temp DB
- **TypeScript**: shared configs in `packages/tsconfig` (strict mode, ESNext target)

---

## Key Architectural Patterns

1. **API response envelope**: `{ success: true, data: T } | { success: false, error: string }`
2. **Soft deletion**: all entities use `isDeleted` flag, never hard-deleted
3. **Per-issue operation lock**: chained Promises prevent concurrent execute/follow-up/restart on same issue
4. **Optimistic UI**: drag-and-drop uses board store for immediate visual feedback; server sync pauses during drag
5. **Three-tier engine discovery cache**: memory → DB → live probe (prevents slow startup)
6. **Event-driven invalidation**: SSE events trigger targeted React Query cache invalidation
7. **Pending message coalescence**: messages queued while AI is busy are merged into a single follow-up on process exit
8. **Auto-retry**: failed sessions retry up to max limit with exponential backoff
9. **Reconciliation**: startup + periodic + event-driven safety net for orphaned sessions
10. **Immutable session IDs**: `externalSessionId` (UUID for Claude, thread ID for Codex) enables session continuity across follow-ups
