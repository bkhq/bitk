# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban app with a Bun/Hono API backend and a React/Vite frontend, structured as a **Bun Workspaces monorepo**.

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

# Database
bun run db:generate          # drizzle-kit generate (creates migration SQL)
bun run db:migrate           # drizzle-kit migrate (applies migrations)
bun run db:reset             # deletes SQLite DB files (data/bitk.db)
```

## Architecture

### Monorepo Structure

```
bitk/
├── apps/
│   ├── api/                    ← @bitk/api
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── eslint.config.mjs
│   │   ├── src/                ← Backend source
│   │   │   ├── index.ts        ← Server entry point
│   │   │   ├── app.ts          ← Hono router
│   │   │   ├── db/             ← Database layer
│   │   │   ├── engines/        ← AI engine executors
│   │   │   ├── routes/         ← API routes
│   │   │   ├── events/         ← SSE event system
│   │   │   └── jobs/           ← Background jobs
│   │   └── test/               ← Backend tests (bun:test)
│   └── frontend/               ← @bitk/frontend
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
├── packages/
│   └── shared/                 ← @bitk/shared (shared types)
│       ├── package.json
│       └── src/index.ts
├── drizzle/                    ← Database migrations
├── scripts/                    ← Build scripts (compile.ts)
├── data/                       ← SQLite database (gitignored)
├── package.json                ← Monorepo root + Catalogs
├── drizzle.config.ts
└── bun.lock                    ← Single lock file
```

### Backend (`apps/api/src/`)

- **Runtime**: Bun with `Bun.serve()` as the HTTP server
- **Router**: Hono — mounted at `/api` via `apps/api/src/app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (`apps/api/src/db/`)
  - Schema defined in `apps/api/src/db/schema.ts` using Drizzle's `sqliteTable`
  - All tables share `commonFields` (ULID `id`, `createdAt`, `updatedAt`, `isDeleted`)
  - Migrations live in `drizzle/` and run automatically on startup
  - Config: `drizzle.config.ts`
- **Logging**: pino (`apps/api/src/logger.ts`)
- **Static serving**: In production, `apps/api/src/index.ts` serves `apps/frontend/dist/` with SPA fallback

#### Security & Middleware (`apps/api/src/app.ts`)

- **Auth**: Handled by external reverse proxy (no built-in auth middleware)
- **Security headers**: `hono/secure-headers` (X-Frame-Options, X-Content-Type-Options, etc.)
- **Global error handler**: `app.onError()` returns `{success: false, error}` envelope; logs via pino
- **Input validation**: All POST/PATCH routes use `@hono/zod-validator` with Zod schemas for runtime type checking

#### Data Layer

- `apps/api/src/db/index.ts` + `apps/api/src/db/schema.ts` — SQLite/Drizzle ORM. Tables: `projects`, `issues`, `sessionTurns`, `executionProcesses`, `executionLogs`, `appSettings`. All route handlers use Drizzle queries directly.
- `apps/api/src/config.ts` — Hardcoded status constants (`STATUSES`, `STATUS_MAP`, `STATUS_IDS`, `DEFAULT_STATUS_ID`). Statuses are fixed (todo, working, review, done) — no DB table.
- Migrations in `drizzle/`, auto-applied on startup.

#### API Routes

All routes are project-scoped under `/api/projects/:projectId/...`:

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
```

All API responses use the envelope `{ success: true, data: T } | { success: false, error: string }`. All routes validate that the project exists and enforce cross-project ownership (issues scoped to their project).

### Frontend (`apps/frontend/`)

- **Framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin
- **Routing**: react-router-dom v7
- **Data fetching**: TanStack React Query v5
- **Drag & drop**: @dnd-kit/react for kanban board
- **Dialogs**: Radix UI (`@radix-ui/react-dialog`)
- **Icons**: lucide-react
- **i18n**: i18next + react-i18next, Chinese (zh, default) and English (en). Translations in `apps/frontend/src/i18n/{en,zh}.json`. Language persisted to localStorage (`i18n-lang`).
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev proxy**: Vite's built-in `server.proxy` forwards `/api/*` requests to the Bun API server (`localhost:3010`) during development

#### State Management

Two state systems, each with a distinct role:

- **TanStack React Query** — Server state (projects, issues). All hooks in `apps/frontend/src/hooks/use-kanban.ts`. Query keys use a `queryKeys` factory with hierarchical keys (e.g. `['projects', projectId, 'issues']`). All hooks have `enabled` guards. `useBulkUpdateIssues` uses optimistic updates. QueryClient defaults: `staleTime: 30s`, `retry: 1`. Statuses are hardcoded constants in `apps/frontend/src/lib/statuses.ts` — not fetched from server.
- **Zustand stores** — Local UI state only:
  - `board-store.ts` — Drag-and-drop state (`groupedItems`, `isDragging`). Syncs from server data but pauses sync while dragging. Uses explicit `resetDragging()` tied to mutation `onSettled`.
  - `panel-store.ts` — Side panel and create dialog open/close state.
  - `view-mode-store.ts` — Kanban/list view toggle, persisted to localStorage (`kanban-view-mode`).

#### Component Areas

- `components/ui/` — shadcn/ui primitives (Button, Dialog, Badge, etc.)
- `components/kanban/` — Kanban board: columns, cards, sidebar, create issue dialog
- `components/issue-detail/` — Issue detail page: chat area, diff panel, issue list, review dialog

#### Component Styling

Components use the shadcn/ui pattern: `cn()` utility (`apps/frontend/src/lib/utils.ts`) combining `clsx` + `tailwind-merge`, with `class-variance-authority` for component variants.

#### Theme

`useTheme()` hook (`apps/frontend/src/hooks/use-theme.ts`) — supports `light`, `dark`, `system` modes, persisted to localStorage (`kanban-theme`).

#### Error Handling

- `ErrorBoundary` component wraps all routes in `main.tsx` — catches render errors with reload button
- `Suspense` with spinner fallback wraps lazy-loaded route components

#### Shared Utilities

- `apps/frontend/src/hooks/use-click-outside.ts` — Shared click-outside hook (used by 5+ components)
- `apps/frontend/src/lib/format.ts` — `formatSize()`, `getProjectInitials()`
- `apps/frontend/src/lib/constants.ts` — `LANGUAGES` constant

#### Frontend Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
```

### Shared Types (`packages/shared/`)

`@bitk/shared` contains TypeScript types used by both backend and frontend. The frontend's `types/kanban.ts` re-exports from `@bitk/shared` for backwards compatibility.

### Dev Workflow

- `bun run dev` starts both API (port 3010) and Vite (port 3000) via `bun --filter '*' dev`. Vite proxies `/api/*` to the API server.
- `bun run dev:api` / `bun run dev:frontend` can be run individually in separate terminals if needed
- Production: `bun run build` then `bun run start` — the Bun server handles both API and static file serving on port 3000

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: Biome (`biome.json` at root) — no semicolons, single quotes
- Frontend tests use vitest + @testing-library/react (`bun run test:frontend`)
- Backend tests use `bun test` with `bun:test` (`bun run test:api`)
- Bun auto-loads `.env` — do not use dotenv
- IDs use ULID (via `ulid` package), not UUID
- Shared types live in `packages/shared/src/index.ts` — frontend re-exports via `apps/frontend/src/types/kanban.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts` — add new endpoints here, then wrap in React Query hooks in `use-kanban.ts`
- All user-facing strings must have i18n keys in both `en.json` and `zh.json`
- All API routes must have Zod schemas via `@hono/zod-validator` — no `c.req.json<T>()` with compile-time-only types
- All route handlers must verify project existence and cross-project ownership before operating on scoped entities
- Dependency versions shared across workspaces are managed via Catalogs in root `package.json`

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
- Keep status updates immediate; do not defer synchronization.
- `docs/task.md` is retained as legacy history during migration; new workflow uses PMA docs as primary source.
