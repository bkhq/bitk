# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban app with a Bun/Hono API backend and a React/Vite frontend, structured as a **Bun Workspaces monorepo**. Issues are assigned to CLI-based AI coding agents (Claude Code, Codex, Gemini CLI) that execute in the user's workspace.

Workspaces:
- `apps/api` (`@bitk/api`) — Backend API server
- `apps/frontend` (`@bitk/frontend`) — React frontend
- `packages/shared` (`@bitk/shared`) — Shared TypeScript types

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

# Database
bun run db:generate          # drizzle-kit generate (creates migration SQL)
bun run db:migrate           # drizzle-kit migrate (applies migrations)
bun run db:reset             # deletes SQLite DB files (data/bitk.db)

# Compile to standalone binary
bun run compile              # builds frontend + embeds assets + compiles binary
bun scripts/compile.ts --target bun-linux-x64 --outfile bitk-linux-x64
```

## Architecture

### Monorepo Structure

```
bitk/
├── apps/
│   ├── api/                    ← @bitk/api
│   │   ├── src/
│   │   │   ├── index.ts        ← Server entry (Bun.serve, static serving, graceful shutdown)
│   │   │   ├── app.ts          ← Hono router + middleware
│   │   │   ├── config.ts       ← Hardcoded statuses (todo/working/review/done)
│   │   │   ├── db/             ← SQLite/Drizzle schema + migrations
│   │   │   ├── engines/        ← AI engine executors + process management
│   │   │   ├── routes/         ← API routes
│   │   │   ├── events/         ← SSE event system
│   │   │   └── jobs/           ← Background jobs (upload cleanup)
│   │   └── test/               ← Backend tests (bun:test)
│   └── frontend/               ← @bitk/frontend
│       └── src/
├── packages/shared/            ← @bitk/shared (TypeScript types)
├── drizzle/                    ← Database migrations (auto-applied on startup)
├── scripts/compile.ts          ← Standalone binary compiler
├── data/                       ← SQLite database (gitignored)
└── drizzle.config.ts
```

### Backend (`apps/api/src/`)

- **Runtime**: Bun with `Bun.serve()` as the HTTP server
- **Router**: Hono — mounted at `/api` via `apps/api/src/app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM
  - Schema: `apps/api/src/db/schema.ts` using Drizzle's `sqliteTable`
  - All tables share `commonFields` (ULID `id`, `createdAt`, `updatedAt`, `isDeleted`)
  - Projects and issues use `shortId()` (nanoid 8-char), logs use `id()` (ULID)
  - Migrations in `drizzle/`, auto-applied on startup
- **Logging**: pino (`apps/api/src/logger.ts`)
- **Static serving**: In production, `index.ts` serves `apps/frontend/dist/` with SPA fallback. In compiled mode, assets are embedded.

#### Middleware (`apps/api/src/app.ts`)

- Security headers: `hono/secure-headers`
- Compression: `hono/compress` (skipped for SSE routes)
- Global error handler: returns `{success: false, error}` envelope; logs via pino
- Input validation: `@hono/zod-validator` with Zod schemas on all POST/PATCH routes

#### Data Layer

- Tables: `projects`, `issues`, `issueLogs`, `issueLogsToolsCall`, `attachments`, `appSettings`
- Statuses are hardcoded constants in `config.ts` (`todo`, `working`, `review`, `done`) — no DB table
- API responses: `{ success: true, data: T } | { success: false, error: string }`

#### API Routes

All issue routes are project-scoped under `/api/projects/:projectId/...`:

```
GET/POST       /api/projects
GET/PATCH      /api/projects/:projectId
GET/POST       /api/projects/:projectId/issues
PATCH          /api/projects/:projectId/issues/bulk
GET/PATCH      /api/projects/:projectId/issues/:id
POST           /api/projects/:projectId/issues/:id/execute
POST           /api/projects/:projectId/issues/:id/follow-up
POST           /api/projects/:projectId/issues/:id/restart
POST           /api/projects/:projectId/issues/:id/cancel
GET            /api/projects/:projectId/issues/:id/logs
GET/POST       /api/projects/:projectId/issues/:id/attachments
GET/POST       /api/projects/:projectId/issues/:id/messages
GET            /api/projects/:projectId/issues/:id/changes
POST           /api/projects/:projectId/issues/:id/title/generate
```

Plus: `/api/engines`, `/api/events`, `/api/settings`, `/api/terminal/ws`.

#### Engine System (`apps/api/src/engines/`)

The engine layer is the most complex part of the backend. Key components:

- **`types.ts`** — Central type definitions: `EngineType` (`claude-code` | `codex` | `gemini` | `echo`), `EngineExecutor` interface, `NormalizedLogEntry`, `ToolAction`, etc.
- **`executors/`** — One directory per engine (`claude/`, `codex/`, `gemini/`, `echo/`), each implementing `EngineExecutor` with `spawn`, `spawnFollowUp`, `cancel`, `normalizeLog`, etc.
  - Claude Code: `stream-json` protocol (streaming JSON over stdout)
  - Codex: `json-rpc` protocol (JSON-RPC over stdio, subprocess stays alive between turns)
  - Gemini: `acp` protocol
  - Echo: test/stub executor
- **`process-manager.ts`** — Generic process lifecycle manager with state tracking, concurrency limits, auto-cleanup, and GC
- **`issue/`** — Issue-scoped orchestration layer (the bridge between API routes and engine executors):
  - `orchestration/` — `execute.ts`, `follow-up.ts`, `restart.ts`, `cancel.ts`
  - `lifecycle/` — Spawn, completion monitoring, turn completion, settle
  - `streams/` — Stream consumption, log classification, event handlers
  - `state/` — State machine actions for issue session status
  - `engine-store.ts` — Issue session field persistence
- **`reconciler.ts`** — Startup + periodic reconciliation (marks stale sessions as failed, moves orphaned working issues to review)
- **`startup-probe.ts`** — Engine discovery (detects installed CLI agents)

### Frontend (`apps/frontend/`)

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin + shadcn/ui components
- **Routing**: react-router-dom v7
- **Data fetching**: TanStack React Query v5
- **Drag & drop**: @dnd-kit/react for kanban board
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **i18n**: i18next + react-i18next, Chinese (zh, default) and English (en). Translations in `apps/frontend/src/i18n/{en,zh}.json`
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev proxy**: Vite `server.proxy` forwards `/api/*` to `localhost:3010`

#### State Management

- **TanStack React Query** — Server state (projects, issues). All hooks in `hooks/use-kanban.ts`. Query keys use `queryKeys` factory. `staleTime: 30s`, `retry: 1`.
- **Zustand stores** — Local UI state only:
  - `board-store.ts` — Drag-and-drop state. Pauses sync while dragging.
  - `panel-store.ts` — Side panel and create dialog open/close.
  - `view-mode-store.ts` — Kanban/list view toggle (localStorage).
  - `terminal-store.ts` / `terminal-session-store.ts` — Terminal state.

#### Component Areas

- `components/ui/` — shadcn/ui primitives (Button, Dialog, Badge, etc.)
- `components/kanban/` — Kanban board: columns, cards, sidebar, create issue dialog
- `components/issue-detail/` — Issue detail page: chat area, diff panel, issue list
- `components/terminal/` — Web terminal (xterm.js)

#### Frontend Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/projects/:projectId/terminal        → TerminalPage
```

### Shared Types (`packages/shared/`)

`@bitk/shared` contains TypeScript types used by both backend and frontend. The frontend's `types/kanban.ts` re-exports from `@bitk/shared`.

### Dev Workflow

- `bun run dev` starts both API (port 3010) and Vite (port 3000). Vite proxies `/api/*` to the API server.
- Production: `bun run build` then `bun run start` — Bun serves both API and static files on port 3000
- Compiled binary: `bun run compile` embeds frontend assets + migrations into a single executable

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Backend eslint: `@antfu/eslint-config` — no semicolons, single quotes
- Frontend eslint: `@tanstack/eslint-config`
- Frontend tests: vitest + @testing-library/react (`bun run test:frontend`)
- Backend tests: `bun test` with `bun:test` (`bun run test:api`). Tests use preload to set `DB_PATH` to an isolated temp DB.
- Bun auto-loads `.env` — do not use dotenv
- IDs use ULID (via `ulid` package) for logs, nanoid 8-char for projects/issues
- Shared types live in `packages/shared/src/index.ts` — frontend re-exports via `types/kanban.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts` — add new endpoints here, wrap in React Query hooks in `use-kanban.ts`
- All user-facing strings must have i18n keys in both `en.json` and `zh.json`
- All API routes must have Zod schemas via `@hono/zod-validator`
- All route handlers must verify project existence and cross-project ownership
- Dependency versions shared across workspaces are managed via Catalogs in root `package.json`
- Component styling: `cn()` utility combining `clsx` + `tailwind-merge`, with `class-variance-authority` for variants

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
