# Test Coverage Audit — bkd Monorepo

**Date:** 2026-03-23
**Auditor:** Automated coverage analysis
**Scope:** `apps/api` (bun:test) and `apps/frontend` (vitest)

---

## 1. Test Inventory

### Backend (`apps/api`) — 32 test files

| File | Category | Test Count |
|------|----------|-----------|
| `test/acp-client.test.ts` | Integration | 13 |
| `test/api-engines.test.ts` | Integration | 9 |
| `test/api-execution.test.ts` | Integration | 17 |
| `test/api-filesystem.test.ts` | Integration | 8 |
| `test/api-health.test.ts` | Integration | 3 |
| `test/api-issues.test.ts` | Integration | 24 |
| `test/api-mcp.test.ts` | Integration | 10 |
| `test/api-pending-messages.test.ts` | Integration | 11 |
| `test/api-process-state-regression.test.ts` | Integration (regression) | 7 |
| `test/api-projects.test.ts` | Integration | 14 |
| `test/api-settings.test.ts` | Integration | 6 |
| `test/api-status-transitions.test.ts` | Integration | 13 |
| `test/auth-jwt.test.ts` | Unit | 5 |
| `test/auth-middleware.test.ts` | Unit | 6 |
| `test/changes-utils.test.ts` | Unit | 13 |
| `test/claude-normalizer.test.ts` | Unit | 47 |
| `test/codex-normalize-log.test.ts` | Unit | 104 |
| `test/codex-protocol.test.ts` | Unit | 23 |
| `test/execution-store.test.ts` | Unit | 12 |
| `test/followup-reconciliation.test.ts` | Integration | 9 |
| `test/gc-stall-detection.test.ts` | Unit | 12 |
| `test/issue-lock.test.ts` | Unit | 3 |
| `test/message-rebuilder.test.ts` | Unit | 11 |
| `test/pending-messages-unit.test.ts` | Unit | 11 |
| `test/reconciler.test.ts` | Integration | 15 |
| `test/startup-probe.test.ts` | Integration | 2 |
| `test/turn-completion-regression.test.ts` | Integration (regression) | 1 |
| `test/upgrade-checksum.test.ts` | Unit | 3 |
| `test/upgrade-files.test.ts` | Unit | 4 |
| `test/upgrade-utils.test.ts` | Unit | 30 |
| `test/worktree.test.ts` | Integration | 6 |
| `src/engines/process-manager.test.ts` | Unit (co-located) | 39 |
| **Total** | | **495 pass, 1 skip** |

**Notes:**
- No E2E tests exist; all tests are unit or integration.
- Integration tests use a real in-process Hono server with an isolated SQLite DB (set via `DB_PATH` in preload).
- `process-manager.test.ts` is co-located in `src/engines/` rather than the `test/` directory — the only such case.
- **⚠️ Critical: `echo` engine removed from registry.** `src/engines/executors/index.ts` no longer registers `EchoExecutor` — only `ClaudeCodeExecutor`, `CodexExecutor`, and `AcpExecutor` are registered. However, **63 occurrences** of `engineType: 'echo'` remain across 10 test files. Tests that only store the string in the DB pass, but any test that routes through the engine registry (e.g. actual execution dispatch) will fail to resolve the executor. **Recommendation: migrate all test `engineType` references from `'echo'` to `'codex'`**, and use a mock/stub of `CodexExecutor` for isolated unit tests.

### Frontend (`apps/frontend`) — 5 test files

| File | Category | Test Count |
|------|----------|-----------|
| `src/__tests__/lib/format.test.ts` | Unit | 20 |
| `src/__tests__/lib/kanban-api.test.ts` | Unit | 9 |
| `src/__tests__/hooks/use-acp-timeline.test.tsx` | Unit (hook) | 5 |
| `src/__tests__/hooks/use-chat-messages.test.tsx` | Unit (hook) | 1 |
| `src/__tests__/hooks/use-issue-stream.test.tsx` | Unit (hook) | 2 |
| **Total** | | **37 pass** |

**Notes:**
- No component rendering tests exist; all tests cover utility functions and hooks.
- No E2E tests exist.
- `@vitest/coverage-v8` is not installed, so frontend coverage cannot be measured.

---

## 2. Coverage Metrics

### Backend Coverage

| Metric | Value |
|--------|-------|
| **Overall branch coverage** | **60.59%** |
| **Overall line coverage** | **64.27%** |
| Target | 80% |
| Status | **BELOW TARGET** |

**Well-covered subsystems (≥90% branch):**

| Module | Branch % |
|--------|----------|
| `src/auth/jwt.ts` | 100% |
| `src/auth/middleware.ts` | 100% |
| `src/config.ts` | 100% |
| `src/engines/process-manager.ts` | 89.58% |
| `src/engines/reconciler.ts` | 85.71% |
| `src/engines/startup-probe.ts` | 96.97% |
| `src/engines/issue/lifecycle/settle.ts` | 100% |
| `src/engines/issue/persistence/entry.ts` | 100% |
| `src/engines/issue/persistence/log-entry.ts` | 100% |
| `src/engines/issue/pipeline/*` | 100% (all files) |
| `src/engines/issue/store/execution-store.ts` | 100% |
| `src/engines/issue/store/message-rebuilder.ts` | 100% |
| `src/routes/issues/create.ts` | 100% |
| `src/routes/issues/delete.ts` | 100% |
| `src/routes/issues/query.ts` | 100% |
| `src/upgrade/utils.ts` | 100% |

**Critically low-coverage subsystems (<20% branch):**

| Module | Branch % | Line % |
|--------|----------|--------|
| `src/auth/oidc.ts` | 0% | 7.76% |
| `src/auth/routes.ts` | 0% | 18.40% |
| `src/cron/index.ts` | 0% | 7.87% |
| `src/cron/executor.ts` | 0% | 11.76% |
| `src/cron/serialize.ts` | 0% | 3.13% |
| `src/cron/actions/builtins/log-cleanup.ts` | 0% | 8.06% |
| `src/cron/actions/builtins/worktree-cleanup.ts` | 0% | 11.54% |
| `src/cron/actions/issues/*` | 0% | ~30% avg |
| `src/pid-lock.ts` | 0% | 5.21% |
| `src/routes/files.ts` | 0% | 5.73% |
| `src/routes/git.ts` | 0% | 22.08% |
| `src/routes/issues/attachments.ts` | 0% | 20.37% |
| `src/routes/issues/changes.ts` | 0% | 5.37% |
| `src/routes/issues/duplicate.ts` | 0% | 10.17% |
| `src/routes/issues/export.ts` | 0% | 18.48% |
| `src/routes/issues/review.ts` | 0% | 25.00% |
| `src/routes/issues/title.ts` | 0% | 15.79% |
| `src/routes/notes.ts` | 0% | 51.61% |
| `src/routes/processes.ts` | 0% | 12.12% |
| `src/routes/settings/about.ts` | 0% | 21.62% |
| `src/routes/settings/cleanup.ts` | 0% | 7.53% |
| `src/routes/settings/recycle-bin.ts` | 0% | 18.29% |
| `src/routes/settings/system-logs.ts` | 0% | 17.19% |
| `src/routes/settings/upgrade.ts` | 0% | 34.31% |
| `src/routes/settings/webhooks.ts` | 0% | 14.92% |
| `src/routes/worktrees.ts` | 0% | 11.01% |
| `src/upgrade/apply.ts` | 0% | 7.83% |
| `src/upgrade/checker.ts` | 0% | 7.78% |
| `src/upgrade/download.ts` | 0% | 10.47% |
| `src/upgrade/files.ts` | 0% | 14.71% |
| `src/upgrade/github.ts` | 0% | 3.70% |
| `src/upgrade/service.ts` | 0% | 20.00% |
| `src/uploads.ts` | 0% | 18.42% |
| `src/webhooks/dispatcher.ts` | 12.50% | 7.23% |

### Frontend Coverage

`@vitest/coverage-v8` is not installed. All 37 tests pass. Coverage percentage is unknown.

**Covered:** `lib/format.ts`, `lib/kanban-api.ts` (partially), `hooks/use-acp-timeline.ts`, `hooks/use-chat-messages.ts`, `hooks/use-issue-stream.ts`

**Uncovered (no test file exists):**
- All React components (`components/kanban/*`, `components/issue-detail/*`, `components/files/*`, etc.)
- All page components (`pages/*.tsx`)
- Zustand stores (`stores/*.ts`)
- Hooks: `use-kanban.ts`, `use-event-connection.ts`, `use-changes-summary.ts`, `use-notes.ts`, `use-auth.ts`, `use-theme.ts`, `use-mobile.ts`, `use-click-outside.ts`
- `lib/event-bus.ts` (EventBus reconnection logic)
- `lib/command-preview.ts`, `lib/shiki.ts`, `lib/auth.ts`

---

## 3. Coverage Gap Matrix

### Backend: Source Files Without Tests

Priority legend: **P1** = Critical path (data integrity/security), **P2** = High value (complex logic), **P3** = Moderate (utility/config)

| Source File | Has Test? | Priority | Notes |
|-------------|-----------|----------|-------|
| `src/engines/issue/lifecycle/completion-monitor.ts` | Partial (30%) | P1 | Core async monitoring; only happy path tested |
| `src/engines/issue/lifecycle/spawn.ts` | Partial (66%) | P1 | Spawns agent processes; failover paths uncovered |
| `src/engines/issue/lifecycle/turn-completion.ts` | Partial (80%) | P1 | Turn lifecycle; error/timeout branches missing |
| `src/engines/issue/orchestration/follow-up.ts` | Partial (75%) | P1 | Codex follow-up path (keep-alive process) untested |
| `src/engines/issue/orchestration/restart.ts` | Partial (42%) | P1 | Restart failure paths uncovered |
| `src/engines/issue/engine.ts` | Partial (37%) | P1 | Main IssueEngine facade; many branches uncovered |
| `src/engines/issue/queries.ts` | Partial (44%) | P1 | DB query layer for issues |
| `src/engines/issue/streams/handlers.ts` | Partial (33%) | P1 | Stream event dispatch |
| `src/routes/issues/changes.ts` | None (0%) | P1 | Git diff route; complex SSE + git logic |
| `src/routes/issues/message.ts` | Partial (60%) | P1 | Follow-up message endpoint; many branches |
| `src/routes/issues/attachments.ts` | None (0%) | P2 | Attachment upload/download |
| `src/routes/issues/title.ts` | None (0%) | P2 | Auto-title generation route |
| `src/routes/issues/duplicate.ts` | None (0%) | P2 | Issue duplication |
| `src/routes/issues/export.ts` | None (0%) | P2 | Issue export |
| `src/routes/issues/review.ts` | None (0%) | P2 | Review management route |
| `src/routes/processes.ts` | None (0%) | P2 | Process list API |
| `src/routes/git.ts` | None (0%) | P2 | Git operations API |
| `src/routes/files.ts` | None (0%) | P2 | File browser API |
| `src/routes/worktrees.ts` | None (0%) | P2 | Worktree management |
| `src/webhooks/dispatcher.ts` | Partial (12%) | P2 | Webhook delivery; retry logic untested |
| `src/upgrade/apply.ts` | None (0%) | P2 | Binary self-upgrade application |
| `src/upgrade/checker.ts` | None (0%) | P2 | Release polling logic |
| `src/upgrade/download.ts` | None (0%) | P2 | Binary download with checksum |
| `src/upgrade/github.ts` | None (0%) | P2 | GitHub API calls |
| `src/upgrade/service.ts` | None (0%) | P2 | Upgrade service orchestration |
| `src/routes/settings/cleanup.ts` | None (0%) | P2 | Data cleanup operations |
| `src/routes/settings/webhooks.ts` | None (0%) | P2 | Webhook CRUD |
| `src/routes/notes.ts` | None (0%) | P3 | Notes CRUD |
| `src/routes/settings/about.ts` | None (0%) | P3 | About/version info |
| `src/routes/settings/recycle-bin.ts` | None (0%) | P3 | Soft-delete recycle bin |
| `src/routes/settings/system-logs.ts` | None (0%) | P3 | System log reading |
| `src/routes/settings/upgrade.ts` | None (0%) | P3 | Settings upgrade endpoints |
| `src/cron/index.ts` | None (0%) | P2 | Cron job scheduler |
| `src/cron/executor.ts` | None (0%) | P2 | Cron action executor |
| `src/cron/actions/issues/*` | None (0%) | P2 | Automated issue actions |
| `src/auth/oidc.ts` | None (0%) | P2 | OIDC authentication flow |
| `src/auth/routes.ts` | None (0%) | P2 | Auth login/logout routes |
| `src/pid-lock.ts` | None (0%) | P3 | PID file-based locking |
| `src/uploads.ts` | None (0%) | P2 | File upload handling |

### Frontend: Source Files Without Tests

| Source File | Has Test? | Priority | Notes |
|-------------|-----------|----------|-------|
| `lib/event-bus.ts` | None | P1 | EventBus reconnection/heartbeat logic |
| `hooks/use-kanban.ts` | None | P1 | Primary data hook (60+ query/mutation hooks) |
| `hooks/use-issue-stream.ts` | Partial (2 tests) | P1 | Most complex hook; many paths untested |
| `hooks/use-changes-summary.ts` | None | P2 | Changes summary SSE hook |
| `hooks/use-event-connection.ts` | None | P2 | SSE connection state hook |
| `stores/board-store.ts` | None | P2 | Drag-and-drop state with sync pausing |
| `stores/panel-store.ts` | None | P3 | Panel open/close state |
| `components/kanban/*` | None | P2 | Core board UI |
| `components/issue-detail/ChatBody.tsx` | None | P2 | Complex chat rendering |
| `components/issue-detail/ChatInput.tsx` | None | P2 | Slash commands, model selector |
| `lib/command-preview.ts` | None | P3 | Command preview formatting |

---

## 4. Top 10 Recommended Tests to Write

### #1 — `completion-monitor.ts`: Retry-on-failure and timeout paths (P1)
**File:** `src/engines/issue/lifecycle/completion-monitor.ts` (30% branch)
**Why:** This module monitors subprocess exit and auto-retries on failure. The retry logic, timeout handling, and keepAlive process special-casing are completely untested. A bug here causes issues to stall permanently.
**Approach:** Unit test with mock `ProcessManager` and mock `Bun.sleep`; simulate process failure at different retry counts.

### #2 — `spawn.ts`: Worktree session fallback path (P1)
**File:** `src/engines/issue/lifecycle/spawn.ts` (66% branch)
**Why:** The worktree fallback path (lines 71–236) executes when the primary working directory is unavailable. Failure here prevents any issue from executing. Only ~41% of lines are covered.
**Approach:** Integration test with a `CodexExecutor` stub; test spawn with an invalid workingDir to force fallback. Do NOT use `engineType: 'echo'` — it is no longer registered.

### #3 — `follow-up.ts` orchestration: Codex keep-alive flow (P1)
**File:** `src/engines/issue/orchestration/follow-up.ts` (75% branch, 40% line)
**Why:** Codex follow-up reuses a live process vs spawning a new one. Lines 60–158 are entirely uncovered. This is the main differentiator between Codex and Claude-Code behavior.
**Approach:** Integration test using a `CodexExecutor` mock/stub that simulates the "process stays alive" contract (i.e., overrides `spawnFollowUp` to reuse the existing process handle rather than spawning a new one). The `echo` engine is no longer registered and should not be used.

### #4 — `event-bus.ts` frontend: Reconnection and heartbeat watchdog (P1)
**File:** `apps/frontend/src/lib/event-bus.ts`
**Why:** The EventBus is the single SSE connection for the whole frontend. Its exponential-backoff reconnect, 35s heartbeat watchdog, and "invalidate all queries on reconnect" behavior have zero test coverage. A bug here causes the entire UI to go stale.
**Approach:** Unit test with mocked `EventSource`; simulate disconnect, heartbeat timeout, and reconnect.

### #5 — `use-kanban.ts`: Core query/mutation hooks (P1)
**File:** `apps/frontend/src/hooks/use-kanban.ts`
**Why:** This file contains every React Query hook used by the application — approximately 60+ hooks. None are tested. Mutations (create, update, delete, execute issue) manipulate critical cache state.
**Approach:** Use `@testing-library/react` + `QueryClientProvider` wrappers with `msw` or `vi.mock` for API calls; test cache invalidation patterns.

### #6 — `engine.ts` facade: Concurrent operation lock behavior (P1)
**File:** `src/engines/issue/engine.ts` (37% branch)
**Why:** The `IssueEngine` singleton serializes all per-issue operations via a per-issue lock. The existing `issue-lock.test.ts` tests the lock primitive directly, but none test the engine facade's integration of lock + DB + event emission.
**Approach:** Integration test using a `CodexExecutor` stub registered into the engine registry; trigger concurrent execute + cancel and verify only one completes. The `echo` engine is no longer registered.

### #7 — `webhooks/dispatcher.ts`: Retry and delivery failure handling (P2)
**File:** `src/webhooks/dispatcher.ts` (12% branch)
**Why:** The webhook dispatcher handles outbound HTTP delivery with retries. At 12% branch coverage, nearly all delivery paths (timeout, HTTP error, retry backoff, permanent failure) are untested.
**Approach:** Unit test with mocked `fetch`; simulate 5xx responses, timeouts, and verify retry counts.

### #8 — `routes/issues/changes.ts`: Git diff SSE streaming (P1)
**File:** `src/routes/issues/changes.ts` (0% branch)
**Why:** This route streams git diff results via SSE. It is entirely untested. The `changes-utils.test.ts` covers the utility functions but not the HTTP layer.
**Approach:** Integration test; create an issue in a git repo worktree, execute it, then call the changes endpoint and verify the SSE stream.

### #9 — `upgrade/*`: Download, checksum, and apply pipeline (P2)
**Files:** `src/upgrade/download.ts`, `src/upgrade/apply.ts`, `src/upgrade/checker.ts`, `src/upgrade/github.ts` (all 0%)
**Why:** The self-upgrade pipeline downloads binaries with SHA-256 checksum verification and applies them. Security and correctness of this flow are entirely unverified beyond the basic `upgrade-checksum.test.ts` (which covers only the hash utility).
**Approach:** Unit tests with mocked `fetch` for GitHub API and download; test checksum mismatch rejection.

### #10 — `board-store.ts`: Drag-and-drop sync pausing (P2)
**File:** `apps/frontend/src/stores/board-store.ts`
**Why:** The board store pauses server sync while dragging (`isDragging` flag) to prevent stale data from overwriting optimistic UI updates. This invariant is critical for the kanban UX but has no tests.
**Approach:** Unit test the Zustand store directly; simulate drag start/end and verify server sync is blocked during drag.

---

## 5. Test Quality Assessment

### Strengths

**Integration test design (backend):** The integration tests are well-structured. Each test file imports a `setup.ts` that registers a `beforeAll` cleanup hook. The `preload.ts` sets `DB_PATH` to an isolated temp directory, ensuring full test isolation without mocking the database. The `helpers.ts` file provides clean `get`, `post`, `patch`, `del` wrappers, `expectSuccess`, and a `waitFor` polling utility. This is a mature approach that catches real DB + route integration bugs.

**Unit tests for core algorithms:** The normalizer tests (`claude-normalizer.test.ts` with 47 tests, `codex-normalize-log.test.ts` with 104 tests) have thorough edge case coverage including malformed JSON, tool use boundaries, streaming chunks, and thinking blocks. These are high-quality unit tests.

**Process manager co-located tests:** The `process-manager.test.ts` (39 tests) is directly adjacent to the source and tests state machine transitions, GC stall detection, and keepAlive behaviors comprehensively.

**Issue lock tests:** `issue-lock.test.ts` tests the queue-full rejection and timeout-restore edge cases with creative use of `setTimeout` monkey-patching. This demonstrates careful attention to concurrency correctness.

### Weaknesses

**`echo` engine removed but still referenced in tests:** The `echo` executor was removed from `src/engines/executors/index.ts` (not registered), yet 63 occurrences of `engineType: 'echo'` remain across 10 test files. Tests that only write the string to the DB still pass, but any execution path that resolves the executor via the registry will silently fail to find it. All test files should migrate to `engineType: 'codex'` with a `CodexExecutor` mock/stub. This is a **P0 maintenance issue** — the execution integration tests (`api-execution.test.ts`, `followup-reconciliation.test.ts`, etc.) are testing a code path that no longer exists in production.

**Single-test files:** `startup-probe.test.ts` (2 tests) and `turn-completion-regression.test.ts` (1 test) are extremely thin. The turn completion test is labeled "regression" but covers only one scenario.

**Frontend over-reliance on mocks:** The `use-issue-stream.test.tsx` mocks both `event-bus` and `kanban-api` completely. While this isolates the hook, it means the actual SSE→React Query cache invalidation pipeline is never tested end-to-end.

**No component tests:** Zero React component tests exist. UI regressions in `ChatBody`, `KanbanCard`, `CreateIssueDialog`, and the slash command flow in `ChatInput` are invisible to the test suite.

**Missing coverage infrastructure for frontend:** `@vitest/coverage-v8` is not installed, making it impossible to measure or enforce frontend coverage thresholds in CI.

**No E2E tests:** Neither workspace has E2E tests. Critical user flows (create project → create issue → execute → view logs → follow up → mark done) are entirely unverified by automated testing.

**Partial tests for high-risk orchestration:** `orchestration/follow-up.ts` is 75% branch but only 40% line covered. The missing 60% of lines are specifically the Codex branch (lines 60–158), which is the only code path that reuses a long-lived process. This is a hidden gap in an already-covered file.

---

## 6. Summary

### ✅ P0 Resolved: Echo Engine Removed, Tests Migrated to Mock Codex

All `engineType: 'echo'` references have been migrated to `engineType: 'codex'`. Tests now use `MockCodexExecutor` (in `test/mock-codex-executor.ts`) which overrides the real `CodexExecutor` registration in the test preload.

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| Backend branch coverage | 60.59% | 80% | -19.41pp |
| Backend line coverage | 64.27% | 80% | -15.73pp |
| Frontend test files | 5 | — | — |
| Frontend coverage | Unknown | 80% | Unknown |
| Backend test files with 0% branch | 34 files | 0 | 34 |
| E2E test files | 0 | ≥1 | 1+ |
| Total backend test cases | 496 | — | — |
| Total frontend test cases | 37 | — | — |

The most critical gaps are in the engine lifecycle subsystem (`completion-monitor.ts`, `spawn.ts`, `follow-up.ts`, `engine.ts`), the route layer for issues (`changes.ts`, `attachments.ts`, `title.ts`), and the frontend's `EventBus` and `use-kanban.ts` hook. Addressing these 10 recommended tests would substantially close the gap toward the 80% target and significantly reduce the risk of silent regressions in the execution pipeline.
