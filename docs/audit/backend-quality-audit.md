# Backend Code Quality Audit

**Date:** 2026-03-23
**Scope:** `apps/api/src/` — Bun/Hono backend
**Methodology:** Read-only static analysis across 169 TypeScript files (26,924 lines)

## Executive Summary

**Overall Quality Rating: B+**

The backend is well-architected with strong patterns in engine process lifecycle, error recovery, and API envelope consistency. The engine subsystem shows careful design with overlapping safety mechanisms (process manager, reconciler, stall detector). Key concerns center on two oversized files (codex normalizer at 1,341 lines, MCP server at 919 lines), several N+1 query patterns in hot paths, and minor type safety gaps. No critical security issues found.

| Metric | Value |
|--------|-------|
| Total files | 169 |
| Total lines | 26,924 |
| Avg lines/file | ~159 |
| Files >800 lines (CRITICAL) | 2 |
| Files 400–800 lines (WARNING) | 11 |
| Functions >50 lines | 14 |
| CRITICAL findings | 4 |
| HIGH findings | 4 |
| MEDIUM findings | 16 |
| LOW findings | 34 |

---

## 1. Code Organization & Structure

### CRITICAL — Oversized Files

| File | Lines | Issue |
|------|-------|-------|
| `engines/executors/codex/normalizer.ts` | 1,341 | Single class with one 864-line `handleCodexEvent()` method |
| `mcp/server.ts` | 919 | One 708-line factory function `createMcpServer()` with ~15 inline tool handlers |

### WARNING — Large Files (400–800 lines)

| File | Lines |
|------|-------|
| `engines/executors/acp/normalizer.ts` | 630 |
| `engines/executors/codex/executor.ts` | 626 |
| `webhooks/dispatcher.ts` | 574 |
| `engines/executors/claude/normalizer.ts` | 557 |
| `engines/executors/claude/executor.ts` | 529 |
| `engines/executors/codex/protocol.ts` | 503 |
| `engines/process-manager.ts` | 496 |
| `routes/settings/cleanup.ts` | 443 |
| `routes/settings/general.ts` | 433 |
| `engines/executors/claude/protocol.ts` | 415 |
| `engines/issue/lifecycle/spawn.ts` | 412 |

### CRITICAL — Oversized Functions (>100 lines)

| Location | Lines | Function |
|----------|-------|----------|
| `engines/executors/codex/normalizer.ts:115` | ~864 | `handleCodexEvent()` — massive switch dispatch |
| `mcp/server.ts:211` | ~708 | `createMcpServer()` — entire server as one function |
| `engines/issue/gc.ts:86` | ~211 | `gcSweep()` — three-tier stall detection inline |
| `engines/issue/lifecycle/spawn.ts:240` | ~172 | `spawnFollowUpProcess()` |
| `routes/issues/message.ts:164` | ~166 | POST `/:id/follow-up` route handler |
| `routes/issues/update.ts:24` | ~157 | PATCH bulk update handler |
| `engines/issue/orchestration/execute.ts:21` | ~153 | `executeIssue()` |
| `routes/issues/update.ts:182` | ~116 | PATCH single update handler |
| `engines/executors/claude/executor.ts:229` | ~111 | `discoverSlashCommandsAndAgents()` |

### Dead Code

| Severity | Item | File |
|----------|------|------|
| HIGH | `class RingBuffer<T>` | `engines/issue/utils/ring-buffer.ts` — zero imports; orphaned after migration to `ExecutionStore` |
| HIGH | `export function createLogEntry()` | `engines/logs.ts` — defined but never called anywhere |
| LOW | `export { AppEventBus }` | `events/index.ts` — class re-exported but only the instance `appEvents` is used |

### Module Cohesion Issues

| Severity | Issue | Location |
|----------|-------|----------|
| HIGH | `mcp/server.ts` duplicates route logic from `routes/issues/create.ts`, `update.ts`, `delete.ts` inside `createMcpServer()` | `mcp/server.ts` |
| HIGH | Cross-layer import: `cron/actions/issues/` imports `ensureWorking` from `routes/issues/_shared.ts` | `cron/actions/issues/execute.ts` |
| MEDIUM | `routes/settings/cleanup.ts` mixes stats/scan/deletion for 4 target types | `routes/settings/cleanup.ts` |
| MEDIUM | `db/helpers.ts` is a catch-all: project queries + migration utilities + startup seeding | `db/helpers.ts` |
| MEDIUM | `webhooks/dispatcher.ts` combines delivery, Telegram formatting, dispatch routing, cleanup | `webhooks/dispatcher.ts` |

### Good Organization

- `engines/executors/{claude,codex,acp}/` — each executor is cleanly self-contained
- `engines/issue/{lifecycle,orchestration,persistence,pipeline,process,streams}/` — fine-grained decomposition
- `routes/issues/` — correctly split by operation
- `upgrade/` — cohesive single-purpose module
- No circular dependencies detected

---

## 2. Error Handling

### Global Error Handler — GOOD

The global `app.onError` in `app.ts:51-78` properly returns `{success: false, error}` envelope, sanitizes `SyntaxError` for JSON parse, and never leaks stack traces. Process-level `unhandledRejection` and `uncaughtException` handlers are registered in `index.ts:29-38`.

### Findings

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `routes/issues/title.ts:56` | Raw `error.message` leaked to client — could contain internal paths/session IDs |
| MEDIUM | `routes/settings/upgrade.ts:144` | Raw OS error message leaked to client in upgrade restart response |
| MEDIUM | `routes/notes.ts` (all handlers) | No try/catch on any CRUD handler — DB errors produce generic 500 with no contextual logging |
| LOW | `routes/issues/create.ts:130` | `void webhookDispatch(...)` without `.catch()` — unhandled rejection risk if dispatch throws before internal try/catch |
| LOW | `routes/issues/delete.ts:82` | Same `void webhookDispatch(...)` pattern |
| LOW | `routes/mcp.ts:76` | `void server.connect(transport)` without `.catch()` |
| LOW | `routes/filesystem.ts:44-49` | `readdir` error silently returns `{success: true, dirs: []}` — misrepresents error as empty directory |
| LOW | `routes/settings/cleanup.ts:84-87` | Per-target cleanup failure returns `{success: true}` — client cannot detect partial failures |
| LOW | Many routes (query, review, webhooks, engines, settings) | No try/catch — rely entirely on global handler, no contextual logging |

### What's Done Well

- All engine execution paths (`execute`, `restart`, `cancel`, `follow-up`) properly try/catch with contextual logging
- Fire-and-forget orchestration functions (`triggerIssueExecution`, `flushPendingAsFollowUp`, `monitorCompletion`) have robust outer try/catch with DB state cleanup
- Zod validation consistently applied across all mutation routes
- Webhook dispatcher internally catches all delivery errors

---

## 3. Database Layer

### N+1 Query Patterns

| Severity | Location | Issue |
|----------|----------|-------|
| HIGH | `webhooks/dispatcher.ts:378` | N sequential dedup `SELECT`s inside webhook dispatch loop — one DB round-trip per matching webhook |
| MEDIUM | `routes/issues/update.ts:91` | Bulk update: per-issue `SELECT` inside transaction loop — 100 issues = 100 SELECTs + 100 UPDATEs |
| MEDIUM | `routes/projects.ts:126` | Project list: N filesystem git-check calls via `Promise.all(rows.map(...))` |
| MEDIUM | `db/helpers.ts:303` | `backfillSortOrders`: N individual `UPDATE`s in nested loop (one-time migration) |
| LOW | `routes/issues/duplicate.ts:93` | Log copying: per-row `INSERT` instead of batch insert |

### Missing/Suboptimal Indexes

| Severity | Location | Issue |
|----------|----------|-------|
| LOW | `db/schema.ts` (cron_jobs) | Missing composite `(isDeleted, enabled)` index for list query |
| LOW | `db/schema.ts` (projects) | `isDeleted` unindexed — low priority for small tables |
| LOW | `db/schema.ts` (issueLogs) | Index column order `(issueId, visible, entryType)` may not be optimal for `(issueId, entryType, visible)` queries |

### Transaction Gaps

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `routes/settings/recycle-bin.ts:77` | Project + issue restore in two separate updates without transaction — crash between them leaves inconsistent state |
| MEDIUM | `routes/issues/delete.ts:57` | Issue soft-delete not wrapped in transaction (single-row, low risk) |

### Soft Delete Consistency

| Severity | Location | Issue |
|----------|----------|-------|
| LOW | `routes/issues/attachments.ts:28` | `attachments.isDeleted` column defined in schema but never filtered in queries |
| LOW | `routes/issues/export.ts:17` | `issueLogs.isDeleted` not filtered in `getAllLogs` |
| LOW | Various | `issuesLogsToolsCall.isDeleted` never filtered on reads |

### What's Done Well

- Multi-step writes consistently wrapped in transactions (create, duplicate, project delete, pending messages, reconciler)
- Migrations are clean: append-only, sequential, no destructive operations
- WAL mode and proper SQLite tuning (64 MB cache, 256 MB mmap)

---

## 4. API Design

### HTTP Status Codes

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `routes/issues/command.ts:143` | Engine lock/busy errors return 400 instead of 409 Conflict — clients can't distinguish input errors from state conflicts |
| LOW | `routes/issues/delete.ts:84` | DELETE returns 200 with body instead of 204 No Content |
| LOW | `routes/issues/command.ts:169,207` | `restart`/`cancel` return 200 instead of 202 Accepted (unlike `execute` which correctly uses 202) |

### Zod Schema Gaps

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `routes/issues/message.ts:54-101` | Multipart follow-up uses manual validation instead of `followUpSchema` Zod schema — two validation paths may drift |
| MEDIUM | `routes/issues/command.ts:150` | `restart`, `cancel`, `auto-title` route params not Zod-validated |
| LOW | `routes/settings/webhooks.ts:195-221` | Channel-specific URL validation done imperatively outside Zod schema |

### Pagination

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `routes/settings/webhooks.ts:272` | Webhook deliveries hard-coded `.limit(50)` — no cursor or total count exposed |
| LOW | `routes/issues/query.ts:11` | Issues list has no pagination (intentional for kanban, but undocumented) |

### REST Convention Issues

| Severity | Location | Issue |
|----------|----------|-------|
| LOW | `routes/projects.ts:141` | `PATCH /api/projects/sort` is redundant with `PATCH /api/projects/:id` |

### What's Done Well

- Consistent `{success: true, data}` / `{success: false, error}` envelope everywhere
- Proper HTTP methods: GET for reads, POST for creates/actions, PATCH for updates, DELETE for soft-deletes
- Resource nesting is clean and consistent

---

## 5. Engine System

### Race Conditions & State Machine

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `reconciler.ts:71-82` | TOCTOU window between re-check and transaction — `executeIssue` could set `sessionStatus='running'` between `hasActiveProcess()` check and DB update |
| MEDIUM | `reconciler.ts:143-155` | Startup reconciliation marks ALL `pending` sessions as `failed` without guard against concurrent operations (mitigated: runs before `server.listen()`) |
| LOW | `reconciler.ts:53` vs `143` | `pending` status treated differently in startup vs periodic reconciliation — undocumented |

### Resource Cleanup

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `executors/codex/executor.ts:97` | `JsonRpcSession` reader: `releaseLock()` during in-flight `read()` produces misleading timeout errors |
| LOW | `process/register.ts:130` | `stdout_broken_no_fallback`: broken-pipe process silently consumes resources for up to 6 min until stall detector |
| LOW | `executors/claude/executor.ts:131` | Claude `cancel()` doesn't await process exit (Codex does) — interface contract inconsistency |

### What's Done Well

- Process manager state machine is well-designed with `TERMINAL_STATES` idempotency guard
- `monitorExit` attaches to `subprocess.exited` immediately on `register()` — exit never missed
- Per-issue serial lock prevents concurrent operations
- Reconciler provides safety net on startup + every 60s + 1s after settlement
- Three-tier stall detection (2+2+2 min) catches hung processes
- `settleIssue` is idempotent with nested try/catch

---

## 6. Logging & Observability

| Severity | Location | Issue |
|----------|----------|-------|
| LOW | `streams/consumer.ts:131` | `consume_stream_error` logged as `warn` — should be `error` (not recoverable, triggers failure) |
| LOW | `streams/consumer.ts:187` | `consume_stderr_stream_error` logged as `debug` — should be `info` |
| LOW | `reconciler.ts:221` | Missing `issueId` context in `reconciler_settled_trigger_failed` log |
| LOW | Multiple files | `{ error: e }` key used instead of pino's standard `{ err: e }` — bypasses error serializer, loses stack traces. Found in: `execute.ts:109`, `execute.ts:122`, `spawn.ts:364` |

---

## 7. TypeScript Quality

### Type Safety Issues

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `engines/issue/state/index.ts:62` | `as any` cast for `QUEUE_INPUT` — bypasses type safety on queued input objects |
| LOW | `executors/claude/executor.ts:462` | `proc as unknown as SpawnedProcess['subprocess']` — double-cast hides Node.js/Bun type mismatch |
| LOW | `gc.ts:53`, `turn-completion.ts:55`, `completion-monitor.ts:103` | `as ProcessStatus` casts for string literals — should type variables directly |
| LOW | `executors/index.ts:34,51` | `'acp' as EngineType` casts — may be unnecessary |
| LOW | `streams/consumer.ts:87-91` | `as string[]` casts skip per-element validation |
| LOW | `persistence/queries.ts:205` | `opts.entryTypes!` non-null assertion — safe but should be eliminated via type refinement |
| LOW | `pipeline/persist.ts:45` | `persisted.messageId!` non-null assertion — redundant (already guarded) |

### Good TypeScript Practices

- Consistent use of `import type` throughout
- No `@ts-ignore` or `@ts-expect-error` abuse found
- `ReadonlySet` used for `TERMINAL_STATES`
- Proper use of generics (e.g., `ProcessManager<TMeta>`)

---

## Summary by Severity

| Severity | Count | Top Issues |
|----------|-------|------------|
| CRITICAL | 4 | `codex/normalizer.ts` (1,341 lines), `handleCodexEvent()` (864-line method), `mcp/server.ts` (919 lines), `createMcpServer()` (708-line function) |
| HIGH | 4 | N+1 webhook dedup queries, dead code (`RingBuffer`, `createLogEntry`), MCP duplicates route logic, cross-layer cron→routes import |
| MEDIUM | 16 | Error message leaks, missing try/catch in notes routes, transaction gaps, TOCTOU in reconciler, bulk update N+1, multipart validation divergence, `as any` cast |
| LOW | 34 | Status code inconsistencies, soft delete filter gaps, missing indexes, log level issues, redundant type assertions, formatting nits |

---

## Recommendations (Priority Order)

1. **Split `codex/normalizer.ts`** — Extract `handleCodexEvent()` into per-event-type handler functions or a dispatch map
2. **Split `mcp/server.ts`** — Extract tool handlers into separate modules; reuse route logic instead of duplicating
3. **Fix N+1 in webhook dispatch** — Batch dedup check into single `WHERE IN` query
4. **Remove dead code** — Delete `ring-buffer.ts` and unused `createLogEntry()` export
5. **Move shared logic** — Extract `ensureWorking`/`parseProjectEnvVars` from routes to a shared engine utility
6. **Add transactions** — Wrap recycle-bin restore and issue delete in `db.transaction()`
7. **Sanitize error messages** — Replace `error.message` with generic strings in `title.ts` and `upgrade.ts`
8. **Unify multipart validation** — Parse form fields into object and run through existing Zod schema
9. **Standardize pino error key** — Use `{ err }` consistently instead of `{ error }` for proper serialization
