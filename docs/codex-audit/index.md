# BKD Repository Audit

- Date: 2026-03-19
- Scope: `apps/api`, `apps/frontend`, `packages/shared`, root scripts, release workflows, upgrade helpers
- Method: static code audit only; no dynamic exploit validation or runtime fuzzing was performed in this pass

## Module Output

| Module | File | Focus |
| --- | --- | --- |
| API runtime shell | `api-runtime.md` | server boot, middleware, global routes, SSE, terminal, trust boundaries |
| API execution engine | `api-execution.md` | issue lifecycle, executors, reconciler, logs, concurrency |
| API data and upgrade | `api-data-upgrade.md` | DB, files, uploads, workspace paths, migrations, upgrade chain |
| Frontend app shell | `frontend-app.md` | routing, React Query, SSE wiring, global stores |
| Frontend high-privilege surfaces | `frontend-surfaces.md` | chat, files, terminal, process manager, settings |
| Repository infrastructure | `repo-infra.md` | build, package, launcher, release, CI, shared contracts |

## Newly Confirmed Findings

| ID | Severity | Summary |
| --- | --- | --- |
| `AUDIT-029` | Critical | `/api/files/*` trusts a caller-provided `root`, exposing arbitrary host filesystem paths |
| `AUDIT-030` | High | `/api/files/*` uses prefix-based root containment and can be bypassed |
| `AUDIT-034` | Critical | privileged API surfaces rely entirely on upstream auth boundaries |
| `AUDIT-035` | Critical | upgrade restart can activate downloaded artifacts without mandatory verification |
| `AUDIT-036` | High | SSE broadcasts cross-project activity to any subscriber |
| `AUDIT-037` | High | issue lock timeout releases mutual exclusion before the timed-out work stops |
| `AUDIT-038` | High | MCP API key is returned to the frontend and rendered in plaintext |
| `AUDIT-039` | Medium | long-running issue streams can drop later log updates after trimming |
| `AUDIT-031` | Medium | full binary compile injects `__BKD_*`, while runtime reads `__BITK_*` |
| `AUDIT-032` | Low | `FileBrowserPage` exists but no frontend route points to it |
| `AUDIT-033` | Medium | launcher release channel is mutable because `launcher-v1` is force-moved on every publish |

## Existing Backlog Re-Mapped Into Modules

### API runtime shell

- `AUDIT-016` partial SSE subscription creation leak
- `AUDIT-018` SPA static fallback unreachable
- `AUDIT-023` cache sweep timer lacks shutdown cleanup
- `AUDIT-026` SSE serialization failures are silent
- `AUDIT-027` no global rate limiting

### API execution engine

- `AUDIT-002` notes route misses project scoping and permission checks
- `AUDIT-004` turn completion settlement race
- `AUDIT-005` engine-domain memory leak
- `AUDIT-006` reconciler scans too narrowly
- `AUDIT-007` reconciler and spawn race
- `AUDIT-008` logs endpoint `limit` lacks Zod validation
- `AUDIT-009` subprocess `exited` promise has no timeout
- `AUDIT-010` lock timeout computes `lockDepth` incorrectly
- `AUDIT-011` `consumeStderr` reader lock is not released
- `AUDIT-012` `finishedAt` timestamp race
- `AUDIT-013` `parentId` query param is unvalidated
- `AUDIT-019` execute/follow-up model regex mismatch
- `AUDIT-020` issues listing has no pagination limit
- `AUDIT-022` `sessionStatus` lacks DB `CHECK` and index
- `AUDIT-025` upload paths leak into AI engine context

### API data and upgrade

- `AUDIT-001` upgrade path traversal
- `AUDIT-003` recycle-bin endpoint exposes deleted issues globally
- `AUDIT-014` upload `originalName` is unsanitized
- `AUDIT-015` workspace path validation is incomplete
- `AUDIT-017` migration error matching regex is brittle
- `AUDIT-021` soft delete does not cascade to logs or attachments
- `AUDIT-024` worktree cleanup silently truncates by batch size

## Cross-Cutting Observations

- The repository relies on an external reverse proxy for authentication and authorization. Inside the app itself, high-privilege surfaces such as terminal, files, upgrade, and MCP are mounted directly under `/api`.
- The heaviest correctness risk is not ordinary CRUD logic. It is the interaction between issue execution, child processes, SSE, reconciler fallback logic, and upgrade/restart behavior.
- The heaviest infrastructure risk is the split between package mode and full compiled binaries. They already use different version symbol contracts, which is a signal that release paths are drifting apart.
- Secrets and admin capabilities are still too willing to cross trust boundaries: the backend can hand frontend code a real MCP bearer token, and the frontend can then render it verbatim in a copyable config block.
- Frontend security mostly mirrors backend posture. The client is a thin layer over powerful server-side capabilities, so backend boundary flaws dominate overall risk.

## Recommended Fix Order

1. Fix `AUDIT-029`, `AUDIT-034`, and `AUDIT-035` before any broader file-browser or upgrade work.
2. Address the existing P0 backend items: `AUDIT-001`, `AUDIT-002`, `AUDIT-003`, `AUDIT-004`.
3. Tighten runtime exposure and event isolation: `AUDIT-036`, rate limiting, SSE cleanup, terminal/files/MCP route gating.
4. Restore concurrency correctness in execution flow: `AUDIT-037`, then the reconciler backlog.
5. Reconcile release paths and admin secret handling: `AUDIT-031`, `AUDIT-033`, `AUDIT-038`, `AUDIT-039`, then low-risk frontend drift such as `AUDIT-032`.
