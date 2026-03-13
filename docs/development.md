# Development Guide

## Quick Start

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Configure environment
cp .env.example .env

# Start dev server (API on 3010, frontend on 3000)
bun run dev
```

## Scripts

```bash
# Development
bun run dev              # API + frontend in parallel
bun run dev:api          # API only (port 3010)
bun run dev:frontend     # Frontend only (port 3000)

# Code Quality
bun run lint             # ESLint check (linting + formatting, all workspaces)
bun run lint:fix         # ESLint auto-fix
bun run format           # Same as lint:fix (formatting is handled by ESLint stylistic rules)

# Testing
bun run test             # All tests (parallel)
bun run test:api         # Backend tests only (bun:test)
bun run test:frontend    # Frontend tests only (vitest)

# Run a single test file
cd apps/api && bun test --preload ./test/preload.ts test/api-issues.test.ts
cd apps/frontend && bunx vitest run src/__tests__/lib/format.test.ts

# Database
bun run db:generate      # Generate migration SQL (drizzle-kit)
bun run db:migrate       # Apply migrations
bun run db:reset         # Delete SQLite DB files

# Production Build
bun run build            # Build frontend (Vite -> apps/frontend/dist/)
bun run start            # Production server (port 3000)

# Compile to Binary
bun run compile                      # Full mode (~105 MB, embeds everything)
bun run compile:launcher             # Launcher mode (~90 MB, loads from data/app/)
bun scripts/compile.ts --target bun-linux-x64 --outfile bkd-linux-x64

# Create App Package
bun run package                      # Build + bundle -> .tar.gz (~1 MB)
bun scripts/package.ts --version 0.0.6 --skip-frontend
```

## Tech Stack

| Layer    | Technology                                                                      |
| -------- | ------------------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh)                                                           |
| Backend  | [Hono](https://hono.dev)                                                        |
| Database | SQLite + [Drizzle ORM](https://orm.drizzle.team)                                |
| Frontend | React 19 + [Vite](https://vite.dev) 7                                           |
| Styling  | [Tailwind CSS](https://tailwindcss.com) v4 + [shadcn/ui](https://ui.shadcn.com) |
| DnD      | [@dnd-kit/react](https://dndkit.com)                                            |
| Terminal | [xterm.js](https://xtermjs.org)                                                 |
| i18n     | [i18next](https://www.i18next.com)                                              |
| Linting  | [@antfu/eslint-config](https://github.com/antfu/eslint-config) (ESLint + stylistic) |

## Project Structure

```
bkd/
├── apps/
│   ├── api/                      ← @bkd/api (backend)
│   │   ├── src/
│   │   │   ├── index.ts          ← Server entry (Bun.serve, static serving)
│   │   │   ├── app.ts            ← Hono router + middleware
│   │   │   ├── config.ts         ← Hardcoded statuses (todo/working/review/done)
│   │   │   ├── db/               ← SQLite/Drizzle schema + migrations
│   │   │   ├── engines/          ← AI engine executors + process management
│   │   │   ├── routes/           ← API routes
│   │   │   ├── events/           ← SSE event system
│   │   │   ├── jobs/             ← Background jobs (upload cleanup, worktree cleanup)
│   │   │   └── upgrade/          ← Self-upgrade system (check, download, apply)
│   │   ├── drizzle/              ← Database migrations
│   │   └── test/                 ← Backend tests (bun:test)
│   └── frontend/                 ← @bkd/frontend
│       └── src/
│           ├── components/       ← UI components (kanban, issue-detail, files, terminal, ui)
│           ├── hooks/            ← React Query + custom hooks
│           ├── pages/            ← Route pages
│           ├── stores/           ← Zustand stores (UI state)
│           ├── lib/              ← API client, utils, event bus
│           ├── i18n/             ← en.json, zh.json
│           └── __tests__/
├── packages/
│   ├── tsconfig/                 ← Shared tsconfig presets
│   └── shared/                   ← @bkd/shared (shared TypeScript types)
├── scripts/
│   ├── compile.ts                ← Binary compiler
│   └── package.ts                ← App packager
├── docs/                         ← Documentation
└── package.json                  ← Monorepo root (Bun Workspaces)
```

## Architecture

### Backend

- **Runtime**: Bun with `Bun.serve()` as the HTTP server
- **Router**: Hono mounted at `/api` via `apps/api/src/app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM
  - Schema: `apps/api/src/db/schema.ts`
  - All tables share `commonFields` (ULID `id`, `createdAt`, `updatedAt`, `isDeleted`)
  - Projects and issues use `shortId()` (nanoid 8-char), logs use `id()` (ULID)
  - Migrations in `apps/api/drizzle/`, auto-applied on startup
- **Logging**: pino (`apps/api/src/logger.ts`)
- **Caching**: In-process LRU+TTL Map-based cache (`cache.ts`, max 500 entries)
- **Static serving**: Three modes — embedded (compiled binary), `APP_DIR/public/` (package mode), `apps/frontend/dist/` (dev)

#### Middleware

- Security headers: `hono/secure-headers`
- Compression: `hono/compress` (skipped for SSE routes: paths ending in `/stream` or `/api/events`)
- HTTP logging: pino-based request logging
- Global error handler: `{ success: false, error }` envelope
- Input validation: `@hono/zod-validator` with Zod schemas

#### Data Layer

- Tables: `projects`, `issues`, `issueLogs`, `issueLogsToolsCall`, `attachments`, `appSettings`
- Statuses are hardcoded in `config.ts` (`todo`, `working`, `review`, `done`)
- API responses: `{ success: true, data: T } | { success: false, error: string }`
- Settings (server name, URL, max concurrency, webhooks, etc.) stored in `appSettings` key-value table

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

System routes:

```
GET/POST       /api/engines/*           ← Engine availability, models
GET            /api/events              ← SSE event stream
GET/PATCH      /api/settings/*          ← App settings, webhooks, upgrade
GET            /api/terminal/ws         ← WebSocket terminal
GET/POST       /api/files/*             ← File browser
GET            /api/filesystem/*        ← Directory listing
GET            /api/git/*               ← Git status, diff
GET            /api/processes/*         ← Active engine processes
GET/POST/DEL   /api/worktrees/*         ← Git worktree management
```

#### Engine System

The engine layer is the most complex part of the backend:

- **`types.ts`** — Central types: `EngineType` (`claude-code` | `codex` | `acp` | `echo`), `EngineExecutor` interface
- **`executors/`** — One per engine (`claude/`, `codex/`, `acp/`, `echo/`), each implementing `EngineExecutor`
  - Claude Code: `stream-json` protocol (process exits after each turn)
  - Codex: `json-rpc` protocol (subprocess stays alive between turns)
  - ACP: `acp` protocol (routes to Gemini/Codex by `acp:<agent>:<model>`)
  - Echo: test/stub executor
- **`process-manager.ts`** — Process lifecycle, concurrency limits, auto-cleanup
- **`issue/`** — Issue-scoped orchestration (bridge between routes and executors)
- **`reconciler.ts`** — Startup + periodic reconciliation (marks stale sessions as failed)
- **`startup-probe.ts`** — Engine discovery (detects installed CLI agents with 3-tier cache)

#### Background Jobs

- **upload-cleanup** (every 1h) — Deletes files in `data/uploads/` older than 7 days
- **worktree-cleanup** (every 30 min) — Removes worktrees for `done` issues older than 1 day; gated by `worktree:autoCleanup` setting

#### Self-Upgrade System

- Polls GitHub Releases every 1h for new versions
- Downloads to `data/updates/` with SHA-256 checksum verification
- Two modes: binary (direct replacement) and package (`.tar.gz` extraction to `data/app/v{version}/`)
- One-click apply from the Settings UI

### Frontend

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Data fetching**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **State**: Zustand for UI-only state (drag state, panel open/close, view mode)
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev proxy**: Vite forwards `/api/*` to `localhost:3010`

#### Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/terminal                            → TerminalPage
```

Three global drawers (lazy-mounted when open): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`.

#### Real-Time Data Flow

```
Server (IssueEngine) → SSE /api/events → EventBus singleton (lib/event-bus.ts)
  → log events → useIssueStream hook → liveLogs state
  → state/done events → React Query cache invalidation
  → issue-updated → projects query invalidation
  → changes-summary → useChangesSummary hook
```

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: @antfu/eslint-config (`eslint.config.js` at root) — no semicolons, single quotes, 2-space indent
  - ESLint enforces `import * as z from 'zod'` (not `import { z } from 'zod'`) via `no-restricted-imports`
  - Import types must use `import type` (separated style) via `@typescript-eslint/consistent-type-imports`
  - Node.js imports must use `node:` prefix
- Frontend tests: vitest + @testing-library/react
- Backend tests: `bun test` with `bun:test`, preload sets `DB_PATH` to temp DB
- Each workspace has its own `.env` — Bun auto-loads from CWD
- IDs: ULID for logs/attachments/tool calls, nanoid 8-char for projects/issues
- Shared types in `packages/shared/src/index.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts`
- All user-facing strings need i18n keys in both `en.json` and `zh.json`
- All API routes need Zod schemas via `@hono/zod-validator`
- All route handlers must verify project existence and cross-project ownership
- Dependency versions managed via Catalogs in root `package.json`
- Component styling: `cn()` utility (`clsx` + `tailwind-merge`) + `class-variance-authority`
- Soft deletion everywhere — `isDeleted` flag, never hard-delete rows

## Environment Variables

### API (`.env` in project root)

| Variable                    | Description                             | Default                         |
| --------------------------- | --------------------------------------- | ------------------------------- |
| `HOST`                      | Listen address                          | `0.0.0.0`                       |
| `PORT`                      | Listen port                             | `3000`                          |
| `ROOT_DIR`                  | Workspace root directory                | auto-detected                   |
| `DB_PATH`                   | SQLite database path                    | `data/db/bkd.db`                |
| `LOG_LEVEL`                 | Log level                               | `info` (binary) / `debug` (dev) |
| `SERVICE_NAME`              | Logger name prefix                      | `bkd`                           |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout               | `1`                             |
| `ANTHROPIC_API_KEY`         | Claude API key                          | —                               |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                  | —                               |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)       | —                               |
| `GOOGLE_API_KEY`            | Google Gemini API key                   | —                               |
| `GEMINI_API_KEY`            | Gemini-specific API key (fallback)      | —                               |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint    | disabled                        |

Server name, server URL, webhooks, max concurrent sessions, and other runtime settings are managed in the Settings UI and persisted in the `appSettings` database table. Environment variables `SERVER_NAME` and `SERVER_URL` are used as initial seed values only.

### Frontend (`apps/frontend/.env`)

| Variable        | Description            | Default   |
| --------------- | ---------------------- | --------- |
| `VITE_DEV_PORT` | Dev server port        | `3000`    |
| `VITE_DEV_HOST` | Dev server host        | `0.0.0.0` |
| `VITE_API_PORT` | API port for dev proxy | `3010`    |

## Adding a New API Endpoint (end-to-end)

1. Define shared types in `packages/shared/src/index.ts`
2. Add route + Zod schema in `apps/api/src/routes/` (verify project ownership for scoped routes)
3. Add API client function in `apps/frontend/src/lib/kanban-api.ts`
4. Add React Query hook in `apps/frontend/src/hooks/use-kanban.ts` (add query key to `queryKeys` factory)
5. Wire into component
6. Add i18n keys in both `en.json` and `zh.json`
