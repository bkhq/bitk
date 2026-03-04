# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban app for managing AI coding agents. Issues on the board are assigned to CLI-based AI engines (Claude Code, Codex, Gemini CLI) that execute autonomously in the user's workspace.

Structured as a **Bun Workspaces monorepo**:
- `apps/api` (`@bitk/api`) — Bun/Hono backend server
- `apps/frontend` (`@bitk/frontend`) — React/Vite frontend
- `packages/shared` (`@bitk/shared`) — Shared TypeScript types
- `packages/tsconfig` (`@bitk/tsconfig`) — Shared TS configs (base, hono, react, utils)

## Commands

```bash
# Dev (starts both API + Vite in parallel via Bun --filter)
bun run dev                  # API on 3010 + Vite on 3000
bun run dev:api              # API server only (port 3010)
bun run dev:frontend         # Vite dev server only (port 3000)

# All workspaces
bun install                  # single install for all workspaces
bun run test                 # run tests in all workspaces (parallel)
bun run lint                 # lint all workspaces

# Backend (@bitk/api)
bun run test:api             # backend tests only
bun --filter @bitk/api lint  # backend lint

# Frontend (@bitk/frontend)
bun run test:frontend        # frontend tests only
bun run build                # vite build -> apps/frontend/dist/
bun --filter @bitk/frontend lint  # frontend lint

# Run a single test file
cd apps/api && bun test --preload ./test/preload.ts test/api-issues.test.ts
cd apps/frontend && bunx vitest run src/__tests__/lib/format.test.ts

# Database (drizzle config lives in apps/api/)
bun run db:generate          # drizzle-kit generate (proxies to @bitk/api)
bun run db:migrate           # drizzle-kit migrate (proxies to @bitk/api)
bun run db:reset             # deletes SQLite DB files (data/bitk.db)

# Compile to standalone binary (full mode — embeds everything, ~105 MB)
bun run compile              # builds frontend + embeds assets + compiles binary
bun scripts/compile.ts --target bun-linux-x64 --outfile bitk-linux-x64

# Compile launcher binary (package mode — minimal binary, ~90 MB)
bun run compile:launcher     # compiles launcher only (loads server from data/app/)
bun scripts/compile.ts --mode launcher --target bun-linux-x64 --outfile bitk-launcher

# Create app package (tar.gz with server.js + assets + migrations, ~1 MB)
bun run package              # builds frontend + bundles server + creates tar.gz
bun scripts/package.ts --version 0.0.6 --skip-frontend
```

## Architecture

### Backend (`apps/api/src/`)

- **Runtime**: Bun with `Bun.serve()` (WebSocket support, `idleTimeout: 60`)
- **Router**: Hono — mounted at `/api` via `app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (WAL mode, 64 MB cache, 256 MB mmap)
  - Schema in `db/schema.ts`. All tables share `commonFields` (`createdAt`, `updatedAt`, `isDeleted` soft delete)
  - Projects/issues use `shortId()` (nanoid 8-char), logs use `id()` (ULID)
  - Migrations in `apps/api/drizzle/`, auto-applied on startup
- **Logging**: pino (`logger.ts`)
- **Caching**: in-process LRU+TTL Map-based cache (`cache.ts`, max 500 entries)
- **Static serving**: three modes — embedded (compiled binary), `APP_DIR/public/` (package mode), `apps/frontend/dist/` (dev)

#### Middleware (`app.ts`)

- `secureHeaders()` — security response headers
- `compress()` — gzip/deflate (skipped for SSE routes: paths ending in `/stream` or `/api/events`)
- `httpLogger()` — pino-based request logging
- `@hono/zod-validator` — Zod schema validation on all POST/PATCH routes
- Global error handler: returns `{success: false, error}` envelope

#### Data Layer

Tables: `projects`, `issues`, `issueLogs`, `issuesLogsToolsCall`, `attachments`, `appSettings` (key-value store for server settings).

Statuses are hardcoded constants in `config.ts` (`todo`, `working`, `review`, `done`) — no DB table.

API response envelope: `{ success: true, data: T } | { success: false, error: string }`

#### API Routes

All issue routes are project-scoped under `/api/projects/:projectId/...`:

```
GET/POST       /api/projects
GET/PATCH/DEL  /api/projects/:projectId
GET/POST       /api/projects/:projectId/issues
PATCH          /api/projects/:projectId/issues/bulk
GET/PATCH/DEL  /api/projects/:projectId/issues/:id
POST           /api/projects/:projectId/issues/:id/execute
POST           /api/projects/:projectId/issues/:id/follow-up
POST           /api/projects/:projectId/issues/:id/restart
POST           /api/projects/:projectId/issues/:id/cancel
POST           /api/projects/:projectId/issues/:id/messages
GET            /api/projects/:projectId/issues/:id/logs
GET/POST       /api/projects/:projectId/issues/:id/attachments
GET            /api/projects/:projectId/issues/:id/changes
POST           /api/projects/:projectId/issues/:id/auto-title
GET            /api/projects/:projectId/issues/:id/slash-commands
```

System routes: `/api/engines/*`, `/api/events` (SSE), `/api/settings/*`, `/api/upgrade/*`, `/api/terminal/ws`, `/api/files/*`, `/api/filesystem/*`, `/api/git/*`, `/api/processes/*`, `/api/worktrees/*`.

Issue routes are split across focused files in `routes/issues/`: `query.ts`, `create.ts`, `update.ts`, `delete.ts`, `command.ts`, `message.ts`, `logs.ts`, `attachments.ts`, `changes.ts`, `title.ts`. Shared schemas and helpers in `_shared.ts`.

#### Engine System (`engines/`)

The most complex subsystem — bridges API routes and CLI-based AI agents.

**Engine types and protocols:**
- `claude-code` — `stream-json` protocol (streaming JSON over stdout, process exits after each turn)
- `codex` — `json-rpc` protocol (JSONL JSON-RPC over stdio, process **stays alive** between turns)
- `gemini` — `acp` protocol
- `echo` — test/stub executor

Each engine has an executor in `executors/<name>/executor.ts` implementing `EngineExecutor` interface: `spawn`, `spawnFollowUp`, `cancel`, `getAvailability`, `getModels`, `normalizeLog`.

**Key subsystems:**
- **`process-manager.ts`** — Generic `ProcessManager<TMeta>` for any Bun.spawn subprocess. State machine: `spawning → running → completed/failed/cancelled`. Groups processes by issue ID. Auto-cleanup after 5 min, GC every 10 min.
- **`issue/engine.ts`** — `IssueEngine` singleton facade. Per-issue serial lock prevents concurrent operations. Manages entry counters, turn indexes, log/state callbacks. Public API: `executeIssue`, `followUpIssue`, `restartIssue`, `cancelIssue`, etc.
- **`issue/orchestration/`** — `execute.ts`, `follow-up.ts`, `restart.ts`, `cancel.ts`
- **`issue/lifecycle/`** — Spawn with session fallback, completion monitoring (auto-retry on failure, pending message coalescence), settlement
- **`issue/streams/`** — Stdout consumption via async generator, log classification, stderr drain
- **`reconciler.ts`** — Safety net: marks stale `running`/`pending` sessions as `failed` on startup; moves orphaned `working` issues to `review`. Runs on startup + every 60s + 1s after each issue settlement.
- **`startup-probe.ts`** — Engine discovery with 3-tier cache: memory (10 min) → DB (`appSettings`) → live probe (15s per-engine timeout, all engines probed in parallel)

**Execution flow:**
```
Route handler → IssueEngine.executeIssue() → acquires per-issue lock
  → updates DB (sessionStatus='running') → executor.spawn() → ProcessManager.register()
  → consumeStream() (async generator over stdout) → persistence/ (DB writes) + events/ (SSE emit)
  → monitorCompletion() watches subprocess.exited → settleIssue() (status → 'review')
```

**Follow-up flow** (Codex is special — process stays alive):
- Claude: spawns new process with `--resume <sessionId>` flag
- Codex: sends `turn/start` to existing process via JSON-RPC; if process died, spawns new `app-server` with `thread/resume`

#### Real-Time Events (`events/`)

Global SSE endpoint (`GET /api/events`) via Hono `streamSSE`:
- Event types: `log`, `state`, `done`, `issue-updated`, `changes-summary`, `heartbeat` (15s)
- Subscribes to `IssueEngine` callbacks + `onIssueUpdated` + `onChangesSummary`
- `changes-summary.ts`: runs `git status/diff` after each issue settles, pushes stats via SSE

#### Background Jobs (`jobs/`)

- `upload-cleanup` (every 1h) — deletes files in `data/uploads/` older than 7 days
- `worktree-cleanup` (every 30 min) — removes worktrees for `done` issues older than 1 day; gated by `worktree:autoCleanup` setting

#### Self-Upgrade (`upgrade/`)

Polls GitHub Releases (`repos/bkhq/bitk/releases/latest`) every 1h. Downloads to `data/updates/` with mandatory SHA-256 checksum verification. Two modes: binary (direct binary replacement) and package (`.tar.gz` extraction to `data/app/v{version}/`).

### Frontend (`apps/frontend/src/`)

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` + shadcn/ui components
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Data fetching**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **Drag & drop**: @dnd-kit/react for kanban board
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **i18n**: i18next + react-i18next, Chinese (zh, default) and English (en). Translations in `src/i18n/{en,zh}.json`
- **Path alias**: `@/*` maps to `src/*`
- **Dev proxy**: Vite `server.proxy` forwards `/api/*` to `localhost:3010`

#### Frontend Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/terminal                            → TerminalPage
```

Three global drawers (lazy-mounted when open): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`.

#### State Management

- **TanStack React Query** — All server state. Hooks in `hooks/use-kanban.ts`. Query keys use `queryKeys` factory.
- **Zustand stores** — Local UI state only:
  - `board-store.ts` — Drag-and-drop grouped items by status. `isDragging` flag pauses server sync.
  - `panel-store.ts` — Side panel and create dialog open/close.
  - `view-mode-store.ts` — Kanban/list toggle (persisted in localStorage).
  - `terminal-store.ts` / `terminal-session-store.ts` — Terminal drawer state + xterm.js session.
  - `file-browser-store.ts` — File browser drawer state + current path.
  - `process-manager-store.ts` — Process manager drawer state.

#### Real-Time Data Flow

```
Server (IssueEngine) → SSE /api/events → EventBus singleton (lib/event-bus.ts)
  → log events → useIssueStream hook → liveLogs state (capped at 500, ULID dedup)
  → state/done events → React Query cache invalidation → component re-renders
  → issue-updated → projects query invalidation
  → changes-summary → useChangesSummary hook
```

`EventBus`: single `EventSource` to `/api/events` with exponential backoff reconnection and 35s heartbeat watchdog. On reconnect: invalidates all React Query caches.

`useIssueStream` (most complex hook): fetches historical logs via HTTP, subscribes to SSE for real-time updates. Two arrays: `liveLogs` (capped at 500) and `olderLogs` (user-loaded pages). ULID-based deduplication.

#### Component Areas

- `components/ui/` — shadcn/ui primitives
- `components/kanban/` — Kanban board: columns, cards, sidebar, create issue dialog, header
- `components/issue-detail/` — Issue detail page: chat area (`ChatBody`), diff panel, issue list, chat input (attachments, slash commands, model selector)
- `components/files/` — File browser: breadcrumbs, directory listing, file viewer (Shiki + markdown)
- `components/terminal/` — xterm.js WebSocket terminal
- `components/processes/` — Active engine process list

### Shared Types (`packages/shared/`)

`@bitk/shared` contains TypeScript types used by both backend and frontend. Frontend re-exports via `types/kanban.ts`. Key types: `Project`, `Issue`, `NormalizedLogEntry`, `ToolAction`, `EngineType`, `SessionStatus`, `ApiResponse<T>`.

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: Biome (`biome.json` at root) — no semicolons, single quotes, 2-space indent
  - **Important**: Biome enforces `import * as z from 'zod'` (not `import { z } from 'zod'`)
  - Import types must use `import type` (separated style)
  - Node.js imports must use `node:` prefix
- Frontend tests: vitest + @testing-library/react (`bun run test:frontend`)
- Backend tests: `bun:test` (`bun run test:api`). Tests use preload to set `DB_PATH` to an isolated temp DB.
- Each workspace has its own `.env` file (`apps/api/.env`, `apps/frontend/.env`) — do not use dotenv. Bun auto-loads `.env` from CWD for API; Vite auto-loads from its project root for frontend.
- IDs: ULID for logs/attachments/tool calls, nanoid 8-char for projects/issues
- Shared types live in `packages/shared/src/index.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts` — add new endpoints here, wrap in React Query hooks in `use-kanban.ts`
- All user-facing strings must have i18n keys in both `en.json` and `zh.json`
- All API routes must have Zod schemas via `@hono/zod-validator`
- All route handlers must verify project existence and cross-project ownership
- Dependency versions shared across workspaces are managed via Catalogs in root `package.json`
- Component styling: `cn()` utility combining `clsx` + `tailwind-merge`, with `class-variance-authority` for variants
- Soft deletion everywhere — `isDeleted` flag, never hard-delete rows

### Adding a New API Endpoint (end-to-end)

1. Define shared types in `packages/shared/src/index.ts`
2. Add route + Zod schema in `apps/api/src/routes/` (verify project ownership for scoped routes)
3. Add API client function in `apps/frontend/src/lib/kanban-api.ts`
4. Add React Query hook in `apps/frontend/src/hooks/use-kanban.ts` (add query key to `queryKeys` factory)
5. Wire into component
6. Add i18n keys in both `en.json` and `zh.json`

## Project Development

Use the /pma skill to manage project development with a strict three-phase workflow:
1. Investigation
2. Proposal
3. Implement -> Verify -> Record

Rules:
- Do not implement before explicit confirmation (`proceed` / `开始实现`).
- Track tasks in `docs/task/index.md` and `docs/task/PREFIX-NNN.md`.
- Track non-trivial plans in `docs/plan/index.md` and `docs/plan/PLAN-NNN.md`.
- Task IDs use `PREFIX-NNN` format (e.g. `AUTH-001`); never skip or reuse IDs.
- **BEFORE starting any task**: claim it atomically (`[ ] -> [-]` in index, set detail `status: in_progress`, set `owner`).
- On completion: set task index marker to `[x]` and detail `status: completed`.
