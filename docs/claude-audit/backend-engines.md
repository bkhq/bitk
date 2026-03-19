# Backend Engine System Audit

## Summary

The engine system (~8,000 lines across 60+ files) is the most complex subsystem in the BKD backend. It bridges API routes with external CLI-based AI agents (Claude Code, Codex, ACP/Gemini), managing process lifecycles, bidirectional protocol communication, log normalization, and real-time event streaming.

**Overall assessment: Well-engineered with strong defensive programming.** The codebase demonstrates mature handling of concurrency, process lifecycle edge cases, and failure recovery. The architecture is clearly decomposed into focused modules with good separation of concerns. A few structural risks exist around mutable shared state and fire-and-forget async patterns.

**Scoring: 4.2/5** (above average for a system of this complexity)

- Code Quality: 4/5
- Error Handling: 4.5/5
- Concurrency Safety: 4/5
- Resource Management: 4/5
- Security: 4.5/5

---

## Architecture Overview

```
engines/
  types.ts              -- Type definitions, interfaces, built-in profiles
  spawn.ts              -- Generic subprocess abstraction (wraps node:child_process)
  process-manager.ts    -- Generic process registry with state machine + GC
  reconciler.ts         -- Startup + periodic stale issue recovery
  startup-probe.ts      -- Engine discovery with 3-tier cache
  safe-env.ts           -- Environment variable allowlist
  command.ts            -- Command builder with quote-aware tokenizer
  engine-store.ts       -- Issue session DB operations
  write-filter.ts       -- Tool name filtering rules
  logs.ts               -- Stream normalization utilities

  executors/
    index.ts            -- Registry singleton, executor registration
    claude/             -- Claude Code executor (stream-json protocol)
    codex/              -- Codex executor (JSON-RPC protocol)
    acp/                -- ACP multi-agent executor
    echo/               -- Mock executor for testing

  issue/
    engine.ts           -- IssueEngine singleton facade
    context.ts          -- Shared context (PM, locks, counters)
    types.ts            -- ManagedProcess interface
    constants.ts        -- Timeouts, limits, thresholds

    orchestration/      -- High-level operations (execute, follow-up, restart, cancel)
    lifecycle/          -- Spawn, completion monitoring, settlement, turn completion
    process/            -- Lock, guards, registration, cancellation, state queries
    persistence/        -- DB writes for log entries, tool details
    pipeline/           -- Ordered event bus stages (persist, ring-buffer, auto-title, failure-detect)
    state/              -- Reducer-style dispatch for ManagedProcess mutations
    store/              -- Per-execution in-memory SQLite store
    streams/            -- Stdout/stderr consumption, classification
    utils/              -- Helpers, normalizer, PID, worktree, visibility, ring-buffer
```

The data flow follows a clear pipeline:

```
Route Handler --> IssueEngine.executeIssue()
  --> withIssueLock() --> executor.spawn() --> ProcessManager.register()
  --> consumeStream() (async generator) --> AppEventBus 'log' event
    --> persist (order 10) --> token-usage (15) --> ring-buffer (20)
    --> auto-title (30) --> failure-detect (40) --> SSE broadcast (100)
  --> monitorCompletion() watches subprocess.exited --> settleIssue()
```

---

## Module Reports

### process-manager.ts
- **Lines**: 496
- **Quality**: 5/5
- **Concurrency Safety**: Strong. State transitions are idempotent (terminal states ignored). `transitionState` checks for terminal before mutating. GC collects candidates into arrays before mutation to avoid iterator invalidation.
- **Resource Management**: Excellent. Auto-cleanup timers with configurable delay, periodic GC with `unref()` so timers don't prevent process exit. `dispose()` calls `terminateAll()` then fires `onRemove` for each entry before clearing.
- **Issues Found**:
  - Line 360: Casting `(entry as { state: ProcessState }).state = next` is a mutable override of a `readonly`-declared field. While intentional (single writer), it bypasses TypeScript's type safety. This is documented via the state module's comment about intentional mutation.
  - The `terminate()` method fires `interruptFn()` before transitioning to 'cancelled'. If the interrupt triggers activity that checks `entry.state`, it will still see the pre-transition state. This is a benign race in the current codebase.
- **Recommendations**:
  - Consider adding a `draining` intermediate state for graceful shutdown to distinguish "cancel requested" from "fully cancelled".

### spawn.ts
- **Lines**: 295
- **Quality**: 4.5/5
- **Concurrency Safety**: N/A (stateless utility functions, except resolveCommand cache)
- **Resource Management**: Good. Process groups via `detached: true` ensure child trees are killed. Kill fallback chain: group kill -> direct kill -> ignore. `resolveCommand` cache is unbounded but entries are small strings; in practice only 3-4 commands are ever resolved.
- **Issues Found**:
  - `resolveCommand` uses a global `Map` cache with no eviction. In practice this is fine (few commands), but it is technically unbounded.
  - `runCommand` timeout kills with `child.kill()` (SIGTERM) but does not retry with SIGKILL. A stubborn process could survive.
- **Recommendations**:
  - Consider adding SIGKILL escalation to `runCommand` timeout handler.

### reconciler.ts
- **Lines**: 227
- **Quality**: 4.5/5
- **Concurrency Safety**: Good. Uses double-check pattern: SELECT stale issues -> re-check `hasActiveProcess` right before UPDATE to close TOCTOU window. Skips `pending` issues to avoid racing with the spawn pipeline. Batch updates in a single transaction.
- **Resource Management**: Timer `unref()`'d. Post-settle reconciliation uses 1s delay to let normal settlement complete first.
- **Issues Found**:
  - The 1s delay in `registerSettledReconciliation` is a magic number. Under heavy load, settlement could take longer than 1s, but this is harmless (reconciler just finds no stale issues).
  - `reconcileStaleWorkingIssues` queries all non-deleted `working` issues every 60s. With many issues, this could become a slow query. Not an issue at expected scale.
- **Recommendations**:
  - None critical. The double-check TOCTOU mitigation is well-designed.

### startup-probe.ts
- **Lines**: 388
- **Quality**: 4/5
- **Concurrency Safety**: Good. Uses `probeInFlight` singleton promise to deduplicate concurrent probe requests. The `finally` block clears it so subsequent calls trigger a fresh probe.
- **Resource Management**: Per-engine 15s timeout prevents a single slow engine from blocking all probes. All engines probed in parallel via `Promise.allSettled`.
- **Issues Found**:
  - `discoverSlashCommands` is fire-and-forget with a 130s timeout. If this hangs, a Claude process could be left running for over 2 minutes. The `killTimer` in the executor's `discoverSlashCommandsAndAgents` mitigates this at 120s.
  - `forceProbeEngines` does not participate in the `probeInFlight` dedup, so calling `forceProbeEngines` while `getEngineDiscovery` is in-flight could spawn duplicate probes. Low risk since force probe is user-triggered.
- **Recommendations**:
  - Consider having `forceProbeEngines` also use the `probeInFlight` dedup to prevent overlapping probes.

### safe-env.ts
- **Lines**: 51
- **Quality**: 5/5
- **Security**: Excellent. Strict allowlist approach prevents leaking `DB_PATH`, `API_SECRET`, or other server-internal variables. Includes proxy vars, XDG dirs, SSL certs, and engine-specific auth keys.
- **Issues Found**: None.
- **Recommendations**:
  - Consider logging when `extra` vars override allowlisted vars (defensive audit trail).

### engine-store.ts
- **Lines**: 109
- **Quality**: 4.5/5
- **Concurrency Safety**: `autoMoveToReview` uses a single atomic UPDATE with all conditions in the WHERE clause to avoid TOCTOU. Excludes `done`, `review`, and `todo` statuses.
- **Issues Found**:
  - `updateIssueSession` builds a dynamic `updates` object but does not validate the input types. If caller passes `sessionStatus: undefined`, it silently skips. This is intentional behavior, but `null` values for `externalSessionId` must be handled carefully since `undefined` is filtered out but `null` passes through.
- **Recommendations**: None.

### issue/engine.ts (IssueEngine singleton)
- **Lines**: 240
- **Quality**: 4/5
- **Concurrency Safety**: Good. All orchestration operations are delegated to functions that acquire `withIssueLock`. The singleton pattern is safe in Node.js single-threaded context.
- **Issues Found**:
  - `followUpIssue` is injected as a mutable property on `ctx` to break a circular dependency. This is a code smell but well-documented.
  - `initMaxConcurrent` uses dynamic import (`await import('@/db/helpers')`) which is unusual but avoids circular dependency at module load time.
- **Recommendations**:
  - Consider a dependency injection pattern to avoid the mutable `followUpIssue` reference.

### issue/types.ts (ManagedProcess)
- **Lines**: 99
- **Quality**: 3.5/5
- **Issues Found**:
  - **This is the most concerning type in the system.** `ManagedProcess` has 30+ mutable fields with complex interdependencies. It is explicitly mutated in-place (documented exception to immutability convention). Fields like `turnSettled`, `turnInFlight`, `logicalFailure`, `lastInterruptAt`, `cancelEscalationId`, `stallDetectedAt`, `stallProbeAt`, `settleTimer`, and `settleTimerStatus` form a complex implicit state machine with no formal state transition diagram.
  - `pendingInputs` is typed as `Array<{...}>` with `any` cast in the dispatch (`action.input as any`).
- **Recommendations**:
  - **HIGH**: Document the valid state combinations. Several bugs could arise from invalid combinations (e.g., `turnSettled=true` + `turnInFlight=true`). A state diagram would help onboarding and prevent regressions.
  - Replace the `as any` cast in dispatch with proper typing.

### issue/gc.ts
- **Lines**: 289
- **Quality**: 4/5
- **Concurrency Safety**: Iterates over a snapshot from `getActive()` so mutations during iteration are safe. Uses `withIssueLock` for settlement to prevent races with follow-ups.
- **Resource Management**: Three-tier stall detection (2min detect -> 2min grace -> 2min kill) is well-designed for giving CLI internal retry a chance.
- **Issues Found**:
  - `terminateAndSettle` fires `withIssueLock` with `void` (fire-and-forget). If the lock times out or the DB write fails, the only recovery is the `.catch` handler emitting `emitIssueSettled`. This is acceptable but means the issue could be left in an inconsistent DB state (working + no process).
  - `isProcessAlive` uses `process.kill(pid, 0)` which can return true for zombie processes.
- **Recommendations**:
  - The fire-and-forget pattern in `terminateAndSettle` should be carefully monitored. Consider adding a metric/counter for settlement failures.

### issue/lifecycle/completion-monitor.ts
- **Lines**: 250
- **Quality**: 4/5
- **Concurrency Safety**: The entire function runs as a `void` async IIFE attached to `subprocess.exited`. Multiple code paths ensure settlement always happens. The `outerErr` catch block is a safety net that always calls `settleIssue`.
- **Issues Found**:
  - Complex branching logic: `turnSettled` path, `pendingInputs` path, `lastInterruptAt` path, `exitCode === 0` path, and failure path. Each has different cleanup requirements. There are 5 distinct exit paths, which increases risk of missed cleanup.
  - After `managed.stdoutDone` resolves, the code checks `managed.turnSettled` which could have been set concurrently by `handleTurnCompleted`. This is intentional (the check is "has the turn already been settled?") but relies on single-threaded JS event loop ordering.
  - Pending input merging uses `join('\n\n')` which could produce unexpectedly long prompts. No size limit on merged prompt.
- **Recommendations**:
  - Add a maximum merged prompt size to prevent accidentally sending megabytes to an AI engine.
  - Consider extracting the 5 exit paths into named functions for clarity.

### issue/lifecycle/turn-completion.ts
- **Lines**: 313
- **Quality**: 4/5
- **Concurrency Safety**: Uses a settle timer (`SETTLE_GRACE_MS = 3s`) that is cleared by `START_TURN` dispatch. The `settleAfterGrace` function re-checks `managed.turnSettled` and DB status before proceeding, protecting against races with follow-ups.
- **Issues Found**:
  - `handleTurnCompleted` uses `void (async () => { ... })()` fire-and-forget for Phase 1 + Phase 2. If Phase 1 throws, the catch block checks for reactivation before emitting `emitIssueSettled`. However, the `freshIssue` DB read in the catch could itself fail, leading to a double-fault. The inner try-catch handles this.
  - The `relocatePendingForProcessing` call could fail silently if the `restorePendingVisibility` rollback also fails.
- **Recommendations**:
  - The nested error handling is thorough but difficult to reason about. Consider adding structured logging for each phase transition.

### issue/orchestration/cancel.ts
- **Lines**: 221
- **Quality**: 4.5/5
- **Concurrency Safety**: Excellent design. Initial interrupt is sent inside `withIssueLock`. Escalation (retry interrupts + hard kill) runs OUTSIDE the lock to avoid blocking other operations. `cancelEscalationId` is used to detect if a follow-up has reactivated the process between retries, preventing hard-killing a legitimate new turn.
- **Issues Found**:
  - `waitForSettlement` uses a polling interval of 200ms. This is fine but introduces up to 200ms latency after settlement before detection.
  - The `isEscalationStale` check could technically see a torn state if `dispatch(START_TURN)` runs between checking `cancelEscalationId` and checking `managed.state`. In single-threaded Node.js this cannot happen.
- **Recommendations**: None critical. This is one of the best-designed modules in the system.

### issue/process/lock.ts
- **Lines**: 101
- **Quality**: 4.5/5
- **Concurrency Safety**: Promise-chain based mutex with acquire timeout (30s), execution timeout (120s), and max queue depth (10). Cleanup in `finally` block is thorough. Slow acquire and long hold are logged as warnings.
- **Issues Found**:
  - On acquire timeout, the code restores `currentTail` to the lock map, which is correct. However, if multiple waiters time out concurrently, the restoration order could leave the wrong tail. In practice this is benign because the timed-out waiter's gate was already released.
  - Execution timeout rejects the promise but does NOT cancel the underlying async operation. The lock holder continues executing even after timeout. This could lead to concurrent operations if the next waiter proceeds.
- **Recommendations**:
  - **MEDIUM**: The execution timeout rejecting without cancelling the underlying operation is a potential source of concurrent access. Consider adding an `AbortSignal` pattern so the timed-out operation can detect it should stop.

### issue/process/register.ts
- **Lines**: 172
- **Quality**: 4/5
- **Resource Management**: Creates per-issue debug log, tees streams for debug capture, wires up protocol activity callback for stall detection. Stream consumption promises are properly `.catch()`'d.
- **Issues Found**:
  - The `register` function takes 13 positional parameters. This is a code smell that makes call sites fragile (wrong argument order is a latent bug).
  - Stdout pipe breakage detection (lines 127-151) logs a warning but takes no corrective action (`no_fallback`). The process is left running with no stdout consumer.
- **Recommendations**:
  - **MEDIUM**: Refactor `register` to accept an options object instead of 13 positional parameters.
  - Consider killing the process on stdout pipe breakage since no further output can be captured.

### issue/store/execution-store.ts
- **Lines**: 305
- **Quality**: 4.5/5
- **Resource Management**: Uses in-memory SQLite (`':memory:'`) with `journal_mode=OFF` and `synchronous=OFF` for maximum performance. Prepared statements compiled once and reused. `destroy()` closes the database. Guard checks (`if (this.destroyed) return`) prevent use-after-close.
- **Issues Found**:
  - The `push` method (RingBuffer compatibility) calls `append` which does a DB insert for every log entry. With high-throughput engines, this could be a bottleneck. However, in-memory SQLite is very fast for inserts.
  - No size limit on the in-memory database. A long-running execution with millions of log entries could consume significant memory. The `AUTO_CLEANUP_DELAY_MS` (5 min) mitigates this by destroying the store after settlement.
- **Recommendations**:
  - Consider adding a maximum entry count with LRU eviction if executions can produce hundreds of thousands of entries.

### issue/streams/consumer.ts
- **Lines**: 191
- **Quality**: 4/5
- **Error Handling**: Per-entry try-catch ensures a single bad entry does not kill the stream consumer. Stream-level errors are caught and forwarded via `onStreamError`. Stderr consumer is fully independent with its own error handling.
- **Issues Found**:
  - `consumeStream` breaks out of the loop when `getManaged()` returns undefined, but the `normalizeStream` async generator's `finally` block still runs `reader.releaseLock()`. This is correct behavior.
  - Stderr entries are always emitted as `error-message` type regardless of content. Some stderr output is informational (e.g., npm warnings), which could mislead users.
- **Recommendations**:
  - Consider filtering or classifying stderr content to distinguish real errors from informational output.

### executors/claude/executor.ts
- **Lines**: 529
- **Quality**: 4/5
- **Security**: Uses `safeEnv()` for all spawned processes. Disables `AskUserQuestion` tool since web UI cannot respond to interactive questions.
- **Issues Found**:
  - Binary resolution caches result in module-level `_cachedBaseCmd`. If the binary is updated while the server is running, the cache is stale. This is intentional and documented.
  - `discoverSlashCommandsAndAgents` has both a `killTimer` (120s) and the caller's `withTimeout` (130s). The kill timer should fire first, but if the read loop blocks, the outer timeout kicks in. Reader lock is released before kill in the early-exit path (line 297-298), which is correct.
  - The `spawnProcess` method creates a `ClaudeProtocolHandler` and performs the SDK handshake synchronously (initialize + setPermissionMode + sendUserMessage). If stdin write fails during handshake, the error propagates correctly.
- **Recommendations**: None critical.

### executors/claude/protocol.ts
- **Lines**: 415
- **Quality**: 4.5/5
- **Concurrency Safety**: The `wrapStdout` ReadableStream uses a pull-based model that processes one line per pull. Control requests are intercepted and auto-responded synchronously. The `closed` flag prevents writes to a closed stdin.
- **Issues Found**:
  - `writeJson` catches write errors and calls `this.close()`, which closes stdin. This is correct behavior: if we cannot respond to control requests, the CLI should detect the broken pipe and exit.
  - Double JSON.parse occurs for control_request and result detection (fast string check then full parse). The string check is a worthwhile optimization since most lines are not control requests.
- **Recommendations**: None.

### executors/codex/executor.ts
- **Lines**: 626
- **Quality**: 4/5
- **Resource Management**: `queryCodexModels` and `verifyAuth` both create short-lived app-server processes with kill timers. Sessions are destroyed in `finally` blocks. Stderr is drained to prevent pipe blocking.
- **Issues Found**:
  - `JsonRpcSession.call()` has a 15s timeout. If the server sends many non-matching lines before the response, the timeout could fire even though the server is alive. The timeout is per-call, not per-idle.
  - `normalizeLog` creates a new `CodexLogNormalizer()` per call, losing all state. The docstring says "Prefer createNormalizer()" which is used in practice. This is a legacy fallback.
  - The `protocolHandler.sendUserMessage` wraps `handler.sendUserMessage` in a `void` call, discarding the returned promise. If the turn/start RPC fails, the error is silently swallowed.
- **Recommendations**:
  - **MEDIUM**: The `void handler.sendUserMessage(content)` in the `protocolHandler` wrapper should propagate errors. Currently, if the RPC fails, the user sees no feedback.

### executors/codex/protocol.ts
- **Lines**: 503
- **Quality**: 4.5/5
- **Concurrency Safety**: Uses a pending request map with timeouts. Background reader processes all stdout immediately, routing responses to their pending promises. Server requests are auto-approved.
- **Issues Found**:
  - `close()` rejects all pending requests with a generic error. This is correct but could mask the root cause.
  - Orphan responses (no matching pending request) are logged as warnings and pushed to the notification stream. This is resilient but could indicate a protocol desync.
- **Recommendations**: None critical.

### executors/acp/executor.ts
- **Lines**: 154
- **Quality**: 4/5
- **Issues Found**:
  - Default agent ID falls back to `'gemini'` when model parsing fails. This could be surprising if a user passes an invalid model string.
  - `cancel` has a 5s SIGKILL timeout but no interrupt mechanism (just calls `spawnedProcess.cancel()`).
- **Recommendations**:
  - Log a warning when falling back to default agent ID.

### executors/echo/executor.ts
- **Lines**: 209
- **Quality**: 4/5
- **Issues Found**:
  - Mock subprocess has `pid: 0`, which is the kernel's PID. `isProcessAlive(0)` via `process.kill(0, 0)` would succeed, potentially causing stall detection issues. In practice, echo executor is only used for testing.
  - `resolveExit` is called from both `cancel` and the stream start controller. The second call is a no-op (Promise already resolved).
- **Recommendations**:
  - Use a non-zero fake PID (e.g., -1 or undefined) to avoid kernel PID collision.

### issue/pipeline/ (index, persist, ring-buffer, auto-title, failure-detect, token-usage)
- **Lines**: ~160 total
- **Quality**: 4.5/5
- **Architecture**: Clean ordered-subscriber pipeline on a global event bus. Each stage is independent; failure in one does not block others. The persist stage (order 10) enriches `data.entry` with `messageId` so downstream stages see it.
- **Issues Found**:
  - `registerPersistStage` wraps tool detail insert + log backfill in `db.transaction()` but calls `persistToolDetail` which has its own try-catch that returns null on failure. If `persistToolDetail` returns null, the transaction still commits with a missing `toolCallRefId`.
  - `registerTokenUsageStage` uses raw SQL `CAST(... AS TEXT)` for cost accumulation. Floating-point precision could drift over many updates.
- **Recommendations**:
  - Consider storing cost in integer cents/microdollars to avoid floating-point drift.

### issue/state/actions.ts + index.ts
- **Lines**: 77 total
- **Quality**: 4/5
- **Issues Found**:
  - The dispatch function is a well-structured reducer, but `QUEUE_INPUT` uses `action.input as any`, which bypasses type safety.
  - `START_TURN` resets many fields (11 assignments). Missing a reset could cause stale state.
- **Recommendations**:
  - Type `QUEUE_INPUT` properly instead of using `as any`.

---

## Critical Issues

None found. The system is production-quality with no critical vulnerabilities or data-loss risks.

---

## High Priority

1. **ManagedProcess implicit state machine** (`issue/types.ts`):
   - 30+ mutable fields with complex interdependencies. No formal state transition documentation. The `dispatch` reducer helps but does not enforce valid state combinations. Risk: subtle bugs from invalid state combinations (e.g., `turnSettled=true` while `turnInFlight=true`).
   - **Recommendation**: Create a state diagram documenting valid transitions. Consider adding runtime invariant checks in debug mode.

2. **Lock execution timeout does not cancel the operation** (`issue/process/lock.ts`):
   - When the 120s execution timeout fires, the promise is rejected but the underlying async function continues executing. The next waiter then proceeds, potentially creating concurrent operations on the same issue.
   - **Recommendation**: Pass an `AbortSignal` through the lock context so timed-out operations can detect cancellation.

3. **Codex sendUserMessage error silently swallowed** (`executors/codex/executor.ts`):
   - The `protocolHandler.sendUserMessage` wrapper uses `void handler.sendUserMessage(content)`, discarding any RPC error. If the turn/start RPC fails, users see no error.
   - **Recommendation**: Propagate the error or at minimum log it and emit an error event.

---

## Medium Priority

1. **`register()` takes 13 positional parameters** (`issue/process/register.ts`):
   - Fragile call sites; wrong argument order is a latent bug.
   - **Recommendation**: Refactor to accept an options object.

2. **No merged prompt size limit** (`issue/lifecycle/completion-monitor.ts`):
   - When flushing pending inputs, all queued prompts are joined with `\n\n`. With many queued messages, this could produce an excessively large prompt.
   - **Recommendation**: Add a maximum size with truncation or error.

3. **Floating-point cost accumulation** (`issue/pipeline/token-usage.ts`):
   - `totalCostUsd` is accumulated via SQL floating-point arithmetic. Over many updates, precision could drift.
   - **Recommendation**: Store costs as integer microdollars.

4. **Stdout pipe breakage with no recovery** (`issue/process/register.ts`):
   - When stdout pipe breaks but the process is still alive, the system logs a warning but takes no action. The process continues running with no output consumer.
   - **Recommendation**: Consider force-killing the process since no further output can be captured.

5. **`QUEUE_INPUT` uses `as any` cast** (`issue/state/index.ts`):
   - Bypasses TypeScript type safety for the pending input queue.
   - **Recommendation**: Define a proper type for the input payload.

---

## Low Priority

1. **resolveCommand cache is unbounded** (`spawn.ts`):
   - No eviction. In practice only 3-4 commands are ever resolved, so this is a non-issue.

2. **Stderr content always emitted as `error-message`** (`streams/consumer.ts`):
   - npm warnings and other informational stderr output appears as errors in the UI.
   - **Recommendation**: Add heuristic classification for known non-error stderr patterns.

3. **Echo executor uses `pid: 0`** (`executors/echo/executor.ts`):
   - Could confuse `isProcessAlive()` checks in stall detection. Only affects test scenarios.
   - **Recommendation**: Use `undefined` instead of `0`.

4. **Binary resolution cache is permanent** (`executors/claude/executor.ts`, `executors/codex/executor.ts`):
   - If a binary is updated while the server is running, the cache is stale until restart. This is intentional.

5. **`runCommand` timeout uses only SIGTERM** (`spawn.ts`):
   - A stubborn process could survive the timeout kill.
   - **Recommendation**: Add SIGKILL escalation after a grace period.

6. **Auto-title prompt is hardcoded in Chinese** (`issue/title.ts`):
   - `AUTO_TITLE_PROMPT` is in Chinese. This may produce non-English titles for English-speaking users.
   - **Recommendation**: Consider making the prompt language configurable or matching the project's i18n setting.

7. **Debug log uses synchronous `appendFileSync`** (`issue/debug-log.ts`):
   - Could cause latency spikes under heavy logging. Mitigated by being disabled by default (only active when `LOG_LEVEL=debug|trace`).

8. **Deprecated functions still present** (`issue/queries.ts`):
   - `getCachedSlashCommands` and `getSlashCommands` are marked `@deprecated` but still exported.
   - **Recommendation**: Remove deprecated functions in a future cleanup pass.
