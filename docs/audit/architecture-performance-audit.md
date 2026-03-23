# Architecture & Performance Audit

**Date:** 2026-03-23
**Scope:** Full monorepo — backend, frontend, shared packages, database, engine system
**Type:** READ-ONLY audit (no code modifications)

---

## Architecture Diagram

```
                            +-----------------+
                            |   Browser/UI    |
                            +--------+--------+
                                     |
                          HTTP / SSE / WebSocket
                                     |
+------------------------------------+------------------------------------+
|                         Bun.serve() (port 3010)                         |
|                                                                         |
|  +------------------+  +------------------+  +------------------------+ |
|  |   Hono Router    |  |  SSE /api/events |  |  WS /api/terminal/ws   | |
|  |  (REST API)      |  |  (EventBus pub)  |  |  (xterm.js bridge)     | |
|  +--------+---------+  +--------+---------+  +------------------------+ |
|           |                      |                                      |
|  +--------v---------+  +--------v---------+                             |
|  | Route Handlers   |  |   Event Bus      |                             |
|  | (Zod validated)  |  |   (pub-sub)      |                             |
|  +--------+---------+  +--------+---------+                             |
|           |                      ^                                      |
|  +--------v---------+           |                                      |
|  | DB Helpers /      |  +-------+--------+                              |
|  | Drizzle ORM       |  | IssueEngine    |                              |
|  +--------+----------+  | (singleton)    |                              |
|           |              +-------+--------+                              |
|  +--------v---------+           |                                      |
|  | SQLite (WAL)      |  +-------v--------+                              |
|  | bun:sqlite        |  | ProcessManager |                              |
|  +-------------------+  | <TMeta>        |                              |
|                         +-------+--------+                              |
|                                 |                                      |
|                    +------------+------------+                          |
|                    |            |            |                          |
|              +-----v----+ +----v-----+ +----v----+                     |
|              | Claude   | | Codex    | | ACP     |                     |
|              | Executor | | Executor | | Executor|                     |
|              | (stream) | | (jsonrpc)| | (agent) |                     |
|              +----------+ +----------+ +---------+                     |
|                                                                         |
|  Background: Reconciler (60s) | GC Sweep (60s) | Cron Jobs             |
+-----------------------------------------------------------------+------+
                                                                   |
+------------------------------------------------------------------v------+
|                      Frontend (Vite dev / embedded)                      |
|                                                                         |
|  React 19 + React Router v7 (lazy routes)                               |
|  TanStack Query v5 (server state) + Zustand (UI state)                  |
|  EventBus singleton (SSE → cache invalidation)                          |
|  Tailwind v4 + shadcn/ui + @dnd-kit (kanban)                           |
|  Shiki (slim) + xterm.js + CodeMirror (lazy)                           |
+-------------------------------------------------------------------------+
                                     |
                          workspace:* imports
                                     |
                    +----------------v-----------------+
                    |  @bkd/shared (types only, 470L)  |
                    |  @bkd/tsconfig (base configs)    |
                    +----------------------------------+
```

---

## 1. Monorepo Architecture

### Workspace Dependency Graph

```
@bkd/api ──────► @bkd/shared (types)
    │                 ▲
    └──► @bkd/tsconfig│
              ▲       │
@bkd/frontend─┴──────►┘
```

**Verdict:** Clean DAG, no circular dependencies. Boundaries are well-maintained.

| Finding | Severity | Details |
|---------|----------|---------|
| Clean workspace boundaries | --- | No circular deps, proper `workspace:*` references |
| Catalog-managed versions | --- | Root `package.json` catalogs `typescript` and `zod` — prevents drift |
| Shared package slightly oversized | LOW | 470 lines, includes frontend-only types (`ChatMessage`, `FileEntry`, `ProcessInfo`) and backend-only types (`AppEventMap`). Could split into `core` + `ui-types` but not urgent |
| Build pipeline efficient | --- | `bun run dev` starts API + Vite in parallel via `--filter`. Compile embeds frontend assets. Package mode creates ~1 MB tar.gz |

### Shared Package Assessment

`@bkd/shared` exports 57 types/interfaces/constants. It serves its purpose as a type bridge but includes some layer-specific types:

- **Backend-only:** `AppEventMap` (internal event bus format) — should live in `@bkd/api`
- **Frontend-only:** `ChatMessage` subtypes, `FileEntry`, `DirectoryListing`, `ProcessInfo` — could move to frontend
- **Correctly shared:** `Project`, `Issue`, `ApiResponse<T>`, `NormalizedLogEntry`, `EngineType`, `SessionStatus`, SSE event types

---

## 2. Backend Architecture

### 2.1 Layering Assessment

**Verdict:** Well-structured with proper separation.

| Layer | Implementation | Quality |
|-------|---------------|---------|
| HTTP/Middleware | Hono + `secureHeaders`, `compress`, `httpLogger`, Zod validation | Excellent |
| Route handlers | `/routes/issues/` split into 10 focused files + `_shared.ts` helpers | Good |
| Business logic | `IssueEngine` singleton, orchestration/, lifecycle/ | Good (complex but justified) |
| Data access | Drizzle ORM with helper functions in `db/helpers.ts` | Good |
| Process management | Generic `ProcessManager<TMeta>` + engine executors | Excellent |

Routes properly delegate to helpers rather than accessing DB directly. Project ownership is verified consistently. All POST/PATCH routes have Zod schema validation.

### 2.2 Engine System

The most complex subsystem (~90 TypeScript files). Manages AI agent lifecycle across three protocols:

| Engine | Protocol | Process Lifecycle | Complexity |
|--------|----------|-------------------|------------|
| Claude Code | stream-json | Exits after each turn | Low |
| Codex | json-rpc | Stays alive between turns | High |
| ACP | Delegated | Agent-specific | Medium |
| Echo | stream-json | Mock/test | Minimal |

**ProcessManager state machine:** `spawning → running → completed/failed/cancelled`
- Idempotent transitions (terminal states cannot be re-entered)
- Auto-cleanup after 5 minutes, GC every 10 minutes
- Kill escalation: SIGINT → 30s grace → SIGKILL

| Finding | Severity | Location | Details |
|---------|----------|----------|---------|
| `pending` status has no runtime timeout | **MEDIUM** | `reconciler.ts:54` | Reconciler skips `pending` issues to avoid racing with spawn. If spawn crashes after setting `pending`, issue is stuck indefinitely. Only recovered on server restart. Should add 30-60s timeout. |
| Codex reader stall on process death | **MEDIUM** | `codex/protocol.ts` | JsonRpcSession reader blocks until 30s timeout if process dies. Each failed RPC incurs 30s delay before fallback. Should add heartbeat/health check. |
| `keepAlive` processes exempt from all GC | **MEDIUM** | `gc.ts:121-141` | No idle timeout, no stall detection, no auto-recovery. Intentional for background agents but a hung `keepAlive` process persists forever. Should apply stall detection with long timeout (30 min). |
| `sessionStatus` set before spawn | MEDIUM | `execute.ts:62-67` | Set to `running` before process registers. If spawn fails, error handler reverts to `failed`. If revert also fails, reconciler catches it. Acceptable but fragile. |
| Follow-up race: message sent to dying process | LOW | `follow-up.ts:64` | Process could exit between active check and send. Try-catch falls back to spawn. Properly handled. |
| Kill timeout accumulation | LOW | `process-manager.ts:156-192` | Rapid `terminate()` calls could accumulate pending timers. Cleared in `finally` block, so harmless in practice. |

### 2.3 Reconciler

**Verdict:** Excellent crash recovery design with three-layer safety net.

1. **Startup reconciliation** — marks stale `running`/`pending` sessions as `failed`; moves orphaned `working` issues to `review`
2. **Periodic reconciliation** (60s) — finds stale working issues with TOCTOU guard (re-checks `hasActiveProcess()` before UPDATE)
3. **Triggered reconciliation** (1s after settlement) — catches edge case where `statusId` update was missed

The TOCTOU race prevention is particularly well-done: the reconciler rechecks active process status immediately before the database UPDATE, preventing it from overwriting freshly-spawned processes.

### 2.4 Cache Strategy

In-memory LRU+TTL cache (`cache.ts`, 90 lines):
- Max 500 entries, TTL-based expiry
- Proactive sweep every 5 minutes
- `cacheGetOrSet()` prevents thundering herd
- Prefix-based bulk invalidation

**Verdict:** Sufficient for single-process deployment. At 500 entries with typical values, memory usage is ~1-2 MB. No concerns.

### 2.5 SSE/Events

Global SSE endpoint with EventBus pub-sub:
- 7 event types: `log`, `log-updated`, `log-removed`, `state`, `done`, `issue-updated`, `changes-summary`, `heartbeat`
- 15s heartbeat keeps connections alive
- AbortSignal-based disconnect detection
- Error-isolated subscribers (one crash doesn't break others)

| Finding | Severity | Details |
|---------|----------|---------|
| No explicit backpressure handling | MEDIUM | If client is slow to read, `stream.writeSSE()` could buffer. Bun's streaming infrastructure likely handles this, but no explicit flow control. |
| Memory per connection reasonable | --- | ~7 event subscribers per SSE connection, ~1 KB each. 100 clients = ~700 KB. |

### 2.6 Graceful Shutdown

**Verdict:** Excellent.

Shutdown flow: set flag → log active processes → stop SSE/timers/jobs → cancel engine processes → stop HTTP → release PID lock → exit. Dual-signal handling (1st = graceful, 2nd = force). All timers use `.unref()`.

One minor gap: no explicit HTTP connection draining (Bun stops accepting immediately), but typical requests complete in <5s.

### 2.7 Error Handling

- Global error handler returns safe `{ success: false, error }` envelope
- Unhandled rejection handler catches fire-and-forget promise failures
- Engine stream consumption wraps each entry in try-catch
- EventBus isolates subscriber errors

**Verdict:** Comprehensive. No silent failure paths identified.

---

## 3. Frontend Architecture

### 3.1 Component Hierarchy

- `AppShell` wraps all routes with `AuthGate` + error boundaries
- 6 lazy-loaded pages + 4 lazy-loaded drawers
- Clean separation: `components/kanban/`, `components/issue-detail/`, `components/files/`, `components/terminal/`, `components/processes/`

### 3.2 State Management

| Layer | Tool | Scope |
|-------|------|-------|
| Server state | TanStack React Query v5 | 45+ query keys, `staleTime: 30s`, 1 retry |
| UI state | Zustand stores | Board drag state, panel/drawer open/close, view mode |
| Real-time | EventBus singleton → Query invalidation | SSE → cache bust → re-render |

**Verdict:** Clean separation. No React Context used (avoids provider re-render thrashing). Zustand stores are focused and minimal.

| Finding | Severity | Location | Details |
|---------|----------|----------|---------|
| Module-level resize listeners fragile in HMR | MEDIUM | `panel-store.ts:67-78`, `terminal-store.ts:56-68`, `process-manager-store.ts:55-67`, `file-browser-store.ts:194-206` | 4 stores attach global resize listeners at module load with guard flags. Could leak during HMR reloads. Should use effect hooks instead. |
| `KanbanColumn` not memoized | LOW | `KanbanColumn.tsx:14` | All 4 columns re-render on any data change. `KanbanCard` is memoized so cost is moderate, but wrapping column in `memo()` would eliminate unnecessary work. |

### 3.3 Real-Time Data Flow

```
SSE /api/events → EventBus singleton → subscribers
  → log events → useIssueStream hook → liveLogs (capped at 500, ULID dedup)
  → state/done → React Query invalidation → re-render
  → issue-updated → project query invalidation
  → changes-summary → useChangesSummary hook (SSE overlay + REST fetch)
```

**EventBus** features:
- Exponential backoff reconnection (1s → 30s max)
- 35s heartbeat watchdog triggers reconnect
- On reconnect: invalidates ALL React Query caches (ensures consistency)

**useIssueStream** (most complex hook):
- Merges HTTP historical logs + SSE real-time updates
- ULID-based O(1) deduplication via `seenIdsRef` + `seenContentKeysRef`
- Execution ID tracking filters stale events from previous turns
- MAX_LIVE_LOGS = 500 (trims oldest when exceeded)

| Finding | Severity | Details |
|---------|----------|---------|
| 500-entry log cap may lose data on SSE flooding | LOW | Rapid tool calls could exceed cap. User must "Load More" to see trimmed entries. Acceptable for typical workloads. |
| ChatMessage rebuild is O(n) on every logs change | LOW | `use-chat-messages.ts:74-250` walks entire entry array in `useMemo`. Wrapped in memo so only rebuilds on reference change. Could cause jank with high tool-call frequency. |

### 3.4 Code Splitting & Bundle

- All 6 pages lazy-loaded via dynamic import
- 4 drawer components lazy-loaded (only mounted when open)
- Manual vendor chunk splitting in Vite config (12 chunks)
- Custom Shiki-slim Vite plugin reduces language/theme bundles dramatically

| Finding | Severity | Details |
|---------|----------|---------|
| CodeMirror language packs may not be lazy-loaded | MEDIUM | 8 `@codemirror/lang-*` packages in `package.json`. If bundled upfront, adds ~150KB+. Should verify they're imported dynamically. |
| No fetch timeout in API client | MEDIUM | `kanban-api.ts:73-90` — fetch has no AbortController timeout. If API hangs, requests stay open indefinitely. Should add 30s timeout. |

---

## 4. Database & Performance

### 4.1 SQLite Configuration

```sql
PRAGMA journal_mode = WAL          -- concurrent reads during writes
PRAGMA foreign_keys = ON           -- referential integrity
PRAGMA busy_timeout = 15000        -- 15s wait before SQLITE_BUSY
PRAGMA synchronous = NORMAL        -- balanced durability
PRAGMA cache_size = -64000         -- 64 MB page cache
PRAGMA mmap_size = 268435456       -- 256 MB memory-mapped I/O
```

**Verdict:** Well-tuned for single-process deployment. WAL mode handles concurrent reads effectively.

### 4.2 Index Coverage

**Verdict:** Comprehensive. All frequently-queried columns have appropriate indexes.

| Table | Indexes | Assessment |
|-------|---------|------------|
| `issues` | project_id, status_id, parent_issue_id, composite (project+status+updatedAt), unique (project+issueNumber) | Excellent |
| `issueLogs` | issue_id, composite (issue_id+turn+entry), composite (issue_id+visible+type) | Excellent |
| `issuesLogsToolsCall` | log_id, issue_id, kind, tool_name, composite (issue_id+kind) | Good |
| `attachments` | issue_id, log_id | Good |
| `webhookDeliveries` | webhook_id, created_at, composite dedup | Good |

### 4.3 Query Patterns

| Finding | Severity | Location | Details |
|---------|----------|----------|---------|
| Issue list endpoint has no pagination | **MEDIUM** | `routes/issues/query.ts:18-22` | `SELECT *` for all issues in a project. Could slow with thousands of issues. Frontend sorts/filters in memory. Should add cursor-based pagination with default limit. |
| Two-pass log pagination | LOW | `persistence/queries.ts:121-189` | Every log page does two DB queries (find conversation boundaries, then fetch entries). Scales linearly with log table size. Acceptable now but monitor at scale. |
| No automatic log retention | **MEDIUM** | Engine constants, cleanup logic | Logs accumulate indefinitely (MAX_LOG_ENTRIES = 10,000 per issue). Manual cleanup via `/api/settings/cleanup`. Should add time-based auto-cleanup for completed issues. |
| Dual soft-delete fields in issueLogs | LOW | `schema.ts:116,28` | Both `visible` and `isDeleted` exist. `visible` = shown to user, `isDeleted` = hard deletion flag. Semantically confusing but functionally correct. |
| No cascade deletes | LOW | All FKs use `ON DELETE no action` | Intentional soft-delete pattern. Cleanup is manual/on-demand. Requires discipline. |

---

## 5. Scalability Concerns

### What Breaks First Under Load?

| Bottleneck | Threshold | Impact | Mitigation |
|------------|-----------|--------|------------|
| **Concurrent issues** | ~50-100 simultaneous | Each spawns a subprocess (Claude/Codex). OS process limits and CPU contention. | ProcessManager tracks count. No explicit limit enforced. |
| **Many SSE clients** | ~500+ connections | 7 subscribers per connection. EventBus dispatch O(n*m) where n=events, m=subscribers. | Acceptable up to ~1000 clients. Beyond that, need event batching. |
| **Large log tables** | ~5M+ rows | Two-pass pagination slows. Full issue log fetch for streaming becomes expensive. | Add time-based retention, archive completed issue logs. |
| **SQLite write contention** | ~100 writes/sec | WAL handles concurrent reads but writes serialize. High tool-call frequency could bottleneck. | `busy_timeout=15s` handles bursts. For sustained load, need write batching or external DB. |
| **In-memory state** | Server restart | ProcessManager entries, ExecutionStore, cache, EventBus subscriptions — all lost. | Reconciler recovers DB state. Cache rebuilds on demand. Processes must be re-spawned. |
| **Log storage growth** | Unbounded | No automatic retention. 1000 issues x 5000 logs = 5M rows. SQLite file grows without bound. | Add auto-cleanup cron for completed issues > N days. |

### SQLite Limitations

- **Single writer:** WAL allows concurrent reads but serializes writes. Under heavy tool-call streaming (multiple issues writing logs simultaneously), write contention could spike.
- **File size:** No built-in compaction. `VACUUM` is expensive and blocks.
- **No replication:** Single-node only. Acceptable for desktop/self-hosted app.

### In-Memory State That Doesn't Survive Restarts

| State | Recovery Mechanism |
|-------|-------------------|
| ProcessManager entries | Reconciler marks orphaned issues as `failed`/`review` |
| ExecutionStore (per-execution log buffer) | Lost — logs already persisted to DB are safe |
| Cache entries | Rebuilt on demand (cache miss → DB/live probe) |
| EventBus subscriptions | Clients reconnect via SSE with backoff |
| Per-issue locks | Released — reconciler prevents stale locks |
| GC stall detection timestamps | Reset — GC starts fresh detection cycle |

---

## 6. Reliability & Resilience

### Graceful Shutdown

**Rating:** Excellent

1. Dual-signal handling (graceful + force)
2. Active process cancellation before HTTP stop
3. PID lock released on exit (with `process.on('exit')` fallback)
4. All timers use `.unref()` for clean exit

### Crash Recovery

**Rating:** Excellent

The three-layer reconciler (startup + periodic + triggered) provides robust crash recovery:
- Startup: marks all `running`/`pending` sessions as `failed`
- Periodic (60s): catches any issues that slipped through
- Triggered (1s after settlement): catches edge cases in completion flow
- TOCTOU guard prevents overwriting freshly-spawned processes

### Data Consistency

| Scenario | Handling |
|----------|----------|
| Server crash mid-execution | Reconciler marks issue as `failed`, moves to `review` |
| Process crash | ProcessManager detects via `subprocess.exited`, triggers settlement |
| DB write failure | Error logged, reconciler catches inconsistent state |
| SSE disconnect | Client reconnects with backoff, invalidates all caches |
| Spawn failure after DB update | Error handler reverts `sessionStatus`, reconciler catches if revert fails |

### Self-Upgrade Safety

- Polls GitHub releases every 1 hour
- Downloads with mandatory SHA-256 checksum verification
- Two modes: binary replacement and package extraction
- Separate shutdown path for upgrade restarts

---

## 7. Developer Experience

| Aspect | Assessment |
|--------|------------|
| **Dev server startup** | Fast — `bun run dev` starts API + Vite in parallel |
| **Type checking** | Good — shared types ensure API/frontend consistency. `@bkd/tsconfig` provides base configs |
| **Test execution** | Backend: `bun:test` (fast). Frontend: `vitest` + testing-library. Separate commands. |
| **Linting** | `@antfu/eslint-config` with consistent rules across workspaces |
| **Documentation** | Comprehensive `CLAUDE.md` with architecture, commands, conventions, and end-to-end guide for adding features |
| **New endpoint workflow** | Well-documented 6-step process: shared types → route + Zod → API client → Query hook → component → i18n |
| **Binary compilation** | Two modes: full (~105 MB) and launcher (~90 MB). Package mode creates ~1 MB tar.gz |

---

## Performance Hotspots (Ranked by Impact)

| Rank | Hotspot | Impact | Current State |
|------|---------|--------|---------------|
| 1 | **Issue list no pagination** | Response grows O(n) with issues | All issues returned per project |
| 2 | **Log table unbounded growth** | Query performance degrades, disk grows | No auto-retention policy |
| 3 | **SQLite write serialization** | Bottleneck under concurrent tool-call streaming | WAL + busy_timeout handles bursts |
| 4 | **Codex reader 30s stall** | 30s delay before fallback when process dies | Per-RPC timeout, no health check |
| 5 | **SSE no backpressure** | Slow clients cause buffer growth | Relies on Bun streaming internals |
| 6 | **Two-pass log pagination** | 2 queries per page load | Efficient for current scale |
| 7 | **ChatMessage O(n) rebuild** | Potential jank on high tool-call frequency | Memoized, only rebuilds on ref change |
| 8 | **Frontend fetch no timeout** | Hung requests stay open indefinitely | No AbortController configured |

---

## Top 10 Actionable Improvements

Ranked by effort/impact ratio (highest value first):

| # | Improvement | Effort | Impact | Category |
|---|-------------|--------|--------|----------|
| 1 | **Add `pending` status timeout (30-60s) in reconciler** | Low | High | Reliability |
| 2 | **Add fetch timeout (AbortController) to frontend API client** | Low | Medium | Reliability |
| 3 | **Add cursor-based pagination to issue list endpoint** | Medium | High | Performance |
| 4 | **Add automatic log retention cron** (delete logs for completed issues > 30 days) | Medium | High | Scalability |
| 5 | **Add `memo()` to KanbanColumn component** | Low | Low | Performance |
| 6 | **Add Codex process health check** before RPC calls | Medium | Medium | Reliability |
| 7 | **Refactor store resize listeners** to use effect hooks instead of module-level side effects | Low | Low | DX/Reliability |
| 8 | **Add stall detection for `keepAlive` processes** with 30-min timeout | Low | Medium | Reliability |
| 9 | **Verify CodeMirror language packs are lazy-loaded** | Low | Medium | Bundle Size |
| 10 | **Move `AppEventMap` to `@bkd/api` internal types** | Low | Low | Architecture |

---

## Summary

### Strengths

- **Excellent crash recovery:** Three-layer reconciler with TOCTOU guards
- **Clean monorepo boundaries:** No circular dependencies, proper workspace isolation
- **Sophisticated real-time pipeline:** SSE → EventBus → Query invalidation with ULID dedup
- **Defensive engine orchestration:** Per-issue locks, idempotent state transitions, multi-tier stall detection
- **Well-structured frontend:** Clean separation of server state (React Query) and UI state (Zustand)
- **Comprehensive graceful shutdown:** Dual-signal handling, timer cleanup, PID lock release
- **Good developer experience:** Well-documented conventions, efficient dev server, clear extension patterns

### Key Risks

- **No pagination on issue list** — will degrade with large projects
- **Unbounded log growth** — no automatic retention policy
- **`pending` status can stall indefinitely** during runtime (only recovered on restart)
- **Codex reader stall** — 30s delay per failed RPC before fallback
- **`keepAlive` processes exempt from all GC** — no automated recovery for hung processes

### Overall Assessment

The architecture is **well-designed for its purpose** as a self-hosted kanban app managing AI agents. The engine system's complexity is justified by the diversity of protocols it supports. The primary concerns are around **scalability limits** (pagination, log retention) and **edge-case reliability** (pending timeout, keepAlive GC). None are critical for current workloads, but addressing items 1-4 from the improvement list would significantly improve robustness at scale.

**Architecture Rating:** 8/10 — Excellent design with minor optimization opportunities.
