# Development Guide

## Quick Start

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Configure environment
cp apps/api/.env.example apps/api/.env
cp apps/frontend/.env.example apps/frontend/.env

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
bun run lint             # ESLint check (all workspaces)
bun run lint:fix         # ESLint auto-fix
bun run format           # Prettier format
bun run format:check     # Prettier check

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
| Linting  | [ESLint](https://eslint.org) + [Prettier](https://prettier.io)                  |

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
│   │   │   └── jobs/             ← Background jobs
│   │   ├── drizzle/              ← Database migrations
│   │   └── test/                 ← Backend tests (bun:test)
│   └── frontend/                 ← @bkd/frontend
│       └── src/
│           ├── components/       ← UI components (kanban, issue-detail, ui)
│           ├── hooks/            ← React Query + custom hooks
│           ├── pages/            ← Route pages
│           ├── stores/           ← Zustand stores (UI state)
│           ├── lib/              ← API client, utils
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
- **Static serving**: In production, serves `apps/frontend/dist/` with SPA fallback

#### Middleware

- Security headers: `hono/secure-headers`
- Compression: `hono/compress` (skipped for SSE)
- Global error handler: `{ success: false, error }` envelope
- Input validation: `@hono/zod-validator` with Zod schemas

#### Data Layer

- Tables: `projects`, `issues`, `issueLogs`, `issueLogsToolsCall`, `attachments`, `appSettings`
- Statuses are hardcoded in `config.ts` (`todo`, `working`, `review`, `done`)
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

#### Engine System

The engine layer is the most complex part of the backend:

- **`types.ts`** — Central types: `EngineType` (`claude-code` | `codex` | `gemini` | `echo`), `EngineExecutor` interface
- **`executors/`** — One per engine (`claude/`, `codex/`, `gemini/`, `echo/`), each implementing `EngineExecutor`
  - Claude Code: `stream-json` protocol
  - Codex: `json-rpc` protocol (subprocess stays alive between turns)
  - Gemini: `acp` protocol
  - Echo: test/stub executor
- **`process-manager.ts`** — Process lifecycle, concurrency limits, auto-cleanup
- **`issue/`** — Issue-scoped orchestration (bridge between routes and executors)
- **`reconciler.ts`** — Startup + periodic reconciliation
- **`startup-probe.ts`** — Engine discovery (detects installed CLI agents)

### Frontend

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Routing**: react-router-dom v7
- **Data fetching**: TanStack React Query v5
- **State**: Zustand for UI-only state (drag state, panel open/close, view mode)
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev proxy**: Vite forwards `/api/*` to `localhost:3010`

#### Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/projects/:projectId/terminal        → TerminalPage
```

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: Biome (`biome.json` at root) — no semicolons, single quotes
- Frontend tests: vitest + @testing-library/react
- Backend tests: `bun test` with `bun:test`, preload sets `DB_PATH` to temp DB
- Each workspace has its own `.env` — Bun auto-loads from CWD
- IDs: ULID for logs, nanoid 8-char for projects/issues
- Shared types in `packages/shared/src/index.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts`
- All user-facing strings need i18n keys in both `en.json` and `zh.json`
- All API routes need Zod schemas via `@hono/zod-validator`
- All route handlers must verify project existence and cross-project ownership
- Dependency versions managed via Catalogs in root `package.json`
- Component styling: `cn()` utility (`clsx` + `tailwind-merge`) + `class-variance-authority`

## Environment Variables

### API (`apps/api/.env`)

| Variable                    | Description                             | Default                         |
| --------------------------- | --------------------------------------- | ------------------------------- |
| `HOST`                      | Listen address                          | `0.0.0.0`                       |
| `PORT`                      | Listen port                             | `3000`                          |
| `API_SECRET`                | Bearer token for auth (unset = no auth) | —                               |
| `ALLOWED_ORIGIN`            | CORS allowed origin                     | `*`                             |
| `DB_PATH`                   | SQLite database path                    | `data/db/bkd.db`                |
| `LOG_LEVEL`                 | Log level                               | `info` (binary) / `debug` (dev) |
| `SERVICE_NAME`              | Logger name prefix                      | `bkd`                           |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout               | `1`                             |
| `MAX_CONCURRENT_EXECUTIONS` | Max parallel agent sessions             | `5`                             |
| `ANTHROPIC_API_KEY`         | Claude API key                          | —                               |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                  | —                               |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)       | —                               |
| `GOOGLE_API_KEY`            | Google Gemini API key                   | —                               |
| `GEMINI_API_KEY`            | Gemini-specific API key (fallback)      | —                               |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint    | disabled                        |

### Frontend (`apps/frontend/.env`)

| Variable        | Description            | Default   |
| --------------- | ---------------------- | --------- |
| `VITE_DEV_PORT` | Dev server port        | `3000`    |
| `VITE_DEV_HOST` | Dev server host        | `0.0.0.0` |
| `VITE_API_PORT` | API port for dev proxy | `3010`    |
