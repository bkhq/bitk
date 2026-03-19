# Frontend State Management & Hooks Audit

**Date**: 2026-03-19
**Scope**: `apps/frontend/src/` — stores, hooks, event bus, API client, utilities
**Files reviewed**: 28

## Summary

The frontend state management architecture is well-structured and follows established patterns. The codebase cleanly separates server state (React Query) from local UI state (Zustand), with a custom EventBus bridging SSE real-time updates into both systems. Code quality is generally high (3.5-4/5 across most files), with strong attention to edge cases in the most complex areas (issue streaming, drag-and-drop).

**Key strengths:**
- Clean separation of concerns between server state and UI state
- Robust deduplication and merge strategies in `use-issue-stream`
- Proper optimistic updates with rollback in mutations (bulk update, notes)
- EventBus with heartbeat watchdog and exponential backoff reconnection
- Consistent query key factory pattern across all React Query hooks

**Key concerns:**
- Significant code duplication across drawer stores (5 stores share ~80% identical logic)
- `use-issue-stream` complexity warrants extraction of sub-modules
- `pathCache` in file-browser-store uses a `Map` that grows without bound
- Some missing `AbortController` usage in API calls within hooks
- `use-chat-messages` and `use-acp-timeline` duplicate substantial helper logic

---

## Zustand Stores

### board-store.ts
- **Lines**: 121
- **Quality**: 4/5
- **Pattern**: Vanilla Zustand store with derived state and optimistic updates for drag-and-drop. Uses `isDragging` flag to pause server sync.
- **Issues Found**:
  - `syncFromServer` creates a new `Date` object for every tiebreaker comparison during sort — minor GC pressure on large boards.
  - `commitDrag` does a linear scan of all columns to find the source card (`O(columns * cards)`). Fine for typical board sizes (<100 cards) but does not scale.
  - The collision fallback (lines 108-115) reassigns sort orders to the entire destination column, which generates a bulk update for every card even if only two collided.
- **Recommendations**:
  - Cache parsed `statusUpdatedAt` timestamps or use numeric epoch in the data model.
  - Consider indexing cards by ID for O(1) lookup in `commitDrag`.

### panel-store.ts
- **Lines**: 79
- **Quality**: 4/5
- **Pattern**: Simple open/close/resize store with derived selectors (`useSelectedIssueId`, `useIsPanelOpen`). Resize listener is HMR-safe via window flag.
- **Issues Found**:
  - Resize listener is never cleaned up (lives for page lifetime). Acceptable for a singleton, but prevents garbage collection in SSR/test contexts.
  - `getViewportWidth()` returns hardcoded 800 for SSR — this value propagates to initial width, causing a flash if the real viewport differs.
- **Recommendations**:
  - Minor: document that the SSR fallback width is intentionally conservative.

### view-mode-store.ts
- **Lines**: 48
- **Quality**: 4/5
- **Pattern**: Persisted to localStorage with sync reads on initialization. Clean, minimal API.
- **Issues Found**:
  - `projectPath` is a derived selector disguised as a store action (it reads state via `get()` but returns a value). This works but is slightly unconventional — a selector outside the store would be more idiomatic.
  - No error handling for `localStorage.setItem` (could throw in Safari private mode, though Bun target makes this unlikely).
- **Recommendations**: None significant.

### terminal-store.ts
- **Lines**: 68
- **Quality**: 4/5
- **Pattern**: Drawer open/close/minimize/fullscreen state with resize clamping. Identical pattern to panel-store, file-browser-store, notes-store, and process-manager-store.
- **Issues Found**:
  - Code duplication: this store is structurally identical to `notes-store`, `process-manager-store`, and partially `file-browser-store`. Only constants (MIN_WIDTH, ratios) differ.
- **Recommendations**:
  - Extract a `createDrawerStore` factory function to eliminate ~200 lines of duplicated boilerplate across 5 stores.

### terminal-session-store.ts
- **Lines**: 33
- **Quality**: 3/5
- **Pattern**: Flat bag of mutable fields (Terminal, WebSocket, timers) with generic `set` and `reset` methods. Used as a coordination point for the terminal component.
- **Issues Found**:
  - Stores raw `WebSocket` and `Terminal` instances — these are not serializable and hold external resources. If `reset()` is called without first closing the WebSocket or disposing the Terminal, resources leak.
  - `reconnectTimer` stored in state but never cleared via `clearTimeout` on reset — potential timer leak.
  - The generic `set` method bypasses type safety — any partial can be applied without validation.
  - `disposed` flag suggests manual lifecycle management, which is fragile.
- **Recommendations**:
  - Add a `dispose()` method that closes the WebSocket, disposes the Terminal, clears the reconnect timer, and then resets state.
  - Consider whether this belongs in a Zustand store at all vs. a class-based service or a ref.

### file-browser-store.ts
- **Lines**: 206
- **Quality**: 3.5/5
- **Pattern**: Most complex drawer store. Adds per-context path caching, drawer vs. inline mode, issue-scoped browsing.
- **Issues Found**:
  - **Memory leak**: `pathCache` is a `Map<string, string>` that grows unbounded. Each unique `projectId:issueId` or `projectId:rootPath` combination adds an entry. Over a long session with many issues, this accumulates.
  - `switchContext` creates a new `Map` copy on every context switch (defensive immutability), which is correct but generates GC pressure. With an unbounded cache, the copies grow larger over time.
  - `close()` sets `isOpen: false` but does not save the current path to cache. Reopening from a different context loses the previous path.
  - The `toggle` and `toggleDrawer` methods have subtly different semantics that could confuse maintainers.
- **Recommendations**:
  - Cap `pathCache` size (e.g., LRU with 50 entries) or clear it when navigating away from a project.
  - Save current path to cache on `close()`.
  - Add JSDoc to clarify the difference between `toggle` (general) and `toggleDrawer` (drawer-specific).

### process-manager-store.ts
- **Lines**: 69
- **Quality**: 4/5
- **Pattern**: Standard drawer store with project scoping. Nearly identical to terminal-store.
- **Issues Found**:
  - Same duplication issue as terminal-store.
- **Recommendations**:
  - Consolidate with shared drawer factory.

### notes-store.ts
- **Lines**: 72
- **Quality**: 4/5
- **Pattern**: Standard drawer store with `selectedNoteId`. Nearly identical to terminal-store.
- **Issues Found**:
  - Same duplication issue.
  - `selectNote` does not validate the note ID exists.
- **Recommendations**:
  - Consolidate with shared drawer factory.

### server-store.ts
- **Lines**: 24
- **Quality**: 4/5
- **Pattern**: Minimal store for server name/URL. `getIssueUrl` is a standalone utility function co-located here.
- **Issues Found**:
  - `getIssueUrl` uses `window.location.origin` directly — not testable and not reactive. If the server URL is configured in the store, it should probably use that instead.
  - `name?.trim() || null` converts empty string to null, which is good defensive coding.
- **Recommendations**:
  - Consider whether `getIssueUrl` should use the store's `url` field when available.

---

## React Query Hooks

### use-kanban.ts
- **Lines**: 976
- **Quality**: 4/5
- **Pattern**: Comprehensive hook file covering all API operations. Uses `queryKeys` factory for consistent cache management. Mutations consistently invalidate related queries on success.
- **Issues Found**:
  - **File size**: At 976 lines, this is the largest file and approaching the recommended 800-line limit. It covers projects, issues, engines, settings, upgrades, files, processes, webhooks — too many domains.
  - `useBulkUpdateIssues` has well-implemented optimistic updates with rollback, but `resetDragging()` in `onSettled` directly accesses Zustand store from React Query — this creates a tight coupling.
  - `useRestartWithUpgrade` uses a polling loop with `setTimeout` chains — this works but is not cancellable if the component unmounts during the polling window.
  - `useProjectFiles` reads Zustand state (`hideIgnored`) inside a React Query hook, creating an implicit dependency. The query key includes `hideIgnored` so cache keys are correct, but the coupling is subtle.
  - Several settings hooks use `staleTime: Infinity` — appropriate for rarely-changing settings but means manual invalidation is the only refresh mechanism.
  - `useSystemLogs` accepts a `lines` parameter but it is not included in the query key, meaning different callers requesting different line counts share the same cache entry.
  - `notesKeys` in `use-notes.ts` is a separate key namespace from `queryKeys` — inconsistent pattern.
- **Recommendations**:
  - Split into domain-specific files: `use-projects.ts`, `use-issues.ts`, `use-engines.ts`, `use-settings.ts`, `use-upgrade.ts`, `use-files.ts`, `use-webhooks.ts`. Re-export from an index.
  - Include `lines` in the `systemLogs` query key.
  - Move `notesKeys` into the `queryKeys` factory in `use-kanban.ts` for consistency.
  - Add `AbortController` / `signal` to the polling in `useRestartWithUpgrade`.
  - Consider extracting the `useBulkUpdateIssues` → `resetDragging` coupling into a dedicated integration hook.

---

## Real-Time Hooks

### use-issue-stream.ts
- **Lines**: 453
- **Quality**: 4/5
- **Pattern**: The most complex hook in the codebase. Manages two log arrays (live + older), ULID-based dedup, SSE subscription, HTTP fetch with merge, cursor-based pagination, and session status tracking. Uses refs extensively to avoid stale closures.
- **Issues Found**:
  - **Complexity**: This single hook manages 7 pieces of state, 7 refs, and 8 callbacks. It handles initial fetch, SSE subscription, pagination, dedup, trim, merge, and status tracking. This is well-written but at the limit of what a single hook should contain.
  - **Race condition (mitigated)**: The comment on line 376 explains why `externalStatus` is excluded from the fetch effect's dependencies — re-fetching on status change races with SSE. This is correct but subtle; a less experienced developer could "fix" the missing dependency and reintroduce the race.
  - **Potential stale closure in `loadOlderLogs`**: `isLoadingOlder` is in the dependency array of `useCallback`, which means `loadOlderLogs` is recreated on every loading state change. This is correct behavior (prevents double-loading) but creates a new function identity on each toggle.
  - **seenIdsRef / seenContentKeysRef grow unbounded**: These `Set` objects accumulate entries for the lifetime of the hook instance. For long-running sessions with thousands of log entries, these sets grow large. They are cleared on `clearLogs` (issue switch) but not trimmed during normal operation.
  - **`appendEntry` calls `isSeen` inside `setLiveLogs`**: The `isSeen` check reads from refs, which is safe, but the `markSeen` side effect inside a state setter is a React anti-pattern (state setters should be pure). In practice, this works because the refs are stable, but it could cause issues with React strict mode double-invocation.
  - **No error boundary integration**: Failed log fetches are caught and logged to console but not surfaced to the UI via state.
  - The `_refreshCounter` state variable naming with underscore prefix is unconventional.
- **Recommendations**:
  - Extract dedup logic (seenIds, seenContentKeys, isSeen, markSeen) into a separate `useDedup` hook or utility class.
  - Extract pagination logic (olderLogs, olderCursor, loadOlderLogs) into a `usePagination` hook.
  - Add a `// eslint-disable-next-line react-hooks/exhaustive-deps` comment with explanation for the intentionally incomplete dependency array on line 378.
  - Consider adding an `error` state for failed fetches.
  - Add periodic trimming of seen sets (e.g., cap at 2000 entries, evict oldest).

### use-chat-messages.ts
- **Lines**: 378
- **Quality**: 4/5
- **Pattern**: Pure transformation hook — converts flat `NormalizedLogEntry[]` into grouped `ChatMessage[]` via `useMemo`. No side effects, no network calls.
- **Issues Found**:
  - `rebuildMessages` is a 275-line function with significant cyclomatic complexity. It handles user messages, assistant messages, thinking, tool groups, task plans, errors, system messages, and command outputs.
  - Code duplication with `use-acp-timeline.ts`: `entryId`, `hasResultFlag`, `isToolUseAction`, `isToolUseResult`, `extractTodos` are duplicated or near-identical.
  - The `commandOutputByIdx` pre-indexing (lines 109-127) is clever but adds complexity. It prevents O(n^2) lookups and cross-command mismatches.
  - The `rebuildMessages` function mutates local variables (`toolBuffer`, `pendingThinking`) extensively — functional purity is limited to the outer `useMemo`.
  - The `seq` counter is local to each call, which is correct for concurrent safety, but generated IDs (`tg-3`, `am-7`) are not stable across re-renders when the log array changes. The code mitigates this by preferring `entry.messageId` where available.
- **Recommendations**:
  - Extract shared helpers (`entryId`, `hasResultFlag`, `isToolUseAction`, `isToolUseResult`) into a `lib/log-utils.ts` module.
  - Consider memoizing `rebuildMessages` more granularly if profiling shows it as a bottleneck (it runs on every log array change).

### use-changes-summary.ts
- **Lines**: 86
- **Quality**: 4.5/5
- **Pattern**: Layered data sourcing — REST (authoritative) + SSE (optimistic preview). SSE overlay is cleared once REST data catches up. Clean and well-documented.
- **Issues Found**:
  - If `projectId` changes while an SSE event is in flight for the old project, the event could briefly set `sseSummary` with stale data. The `issueId` check on line 51 mitigates this for issue changes but not project changes.
  - Minor: the `dataUpdatedAt` comparison (line 36) uses `Date.now()` vs. React Query's internal timestamp. These use the same clock but could theoretically differ by a few ms.
- **Recommendations**:
  - Add `projectId` to the SSE callback guard (line 51) for full safety.

### use-acp-timeline.ts
- **Lines**: 263
- **Quality**: 3.5/5
- **Pattern**: ACP-specific timeline builder, similar structure to `use-chat-messages` but with streaming assistant message concatenation. Pure `useMemo` transformation.
- **Issues Found**:
  - **Heavy duplication** with `use-chat-messages.ts`: `entryId`, `hasResultFlag`, `isToolUseAction`, `isToolUseResult` are copied verbatim. `buildToolGroup` is nearly identical. `extractTodos` is imported but the rest is duplicated.
  - Streaming assistant concatenation (lines 171-188) mutates objects via spread (`{ ...entry }`), which is safe but creates many intermediate objects for long streaming sequences.
  - The `shouldHideAcpEntry` function uses hardcoded string comparisons for content (`'ACP session loaded'`, etc.) — fragile if server-side messages change.
- **Recommendations**:
  - Extract shared helpers to `lib/log-utils.ts` (same as `use-chat-messages` recommendation).
  - Replace magic string comparisons with a metadata flag from the server.

### use-event-connection.ts
- **Lines**: 17
- **Quality**: 5/5
- **Pattern**: Minimal wrapper around EventBus connection state. Clean and correct.
- **Issues Found**: None.
- **Recommendations**: None.

### use-click-outside.ts
- **Lines**: 21
- **Quality**: 4.5/5
- **Pattern**: Standard click-outside hook with ref-based callback to avoid stale closures. Only attaches listener when `open` is true.
- **Issues Found**:
  - Uses `mousedown` instead of `pointerdown` — misses touch events on some devices. However, mobile support may not be a priority.
- **Recommendations**:
  - Consider `pointerdown` for better cross-device support.

### use-mobile.ts
- **Lines**: 19
- **Quality**: 4/5
- **Pattern**: Uses `matchMedia` for responsive breakpoint detection with proper cleanup.
- **Issues Found**:
  - Returns `false` during SSR/initial render (`!!undefined === false`). This means mobile-specific UI briefly shows desktop layout on mobile before the effect runs.
  - `window.innerWidth` check in `onChange` handler diverges from the media query approach — could use `mql.matches` instead for consistency.
- **Recommendations**:
  - Use `mql.matches` in the `onChange` handler for consistency.

### use-notes.ts
- **Lines**: 75
- **Quality**: 4.5/5
- **Pattern**: Standard React Query CRUD hooks with optimistic updates for update and delete mutations. Clean rollback logic.
- **Issues Found**:
  - `notesKeys` is defined locally rather than in the shared `queryKeys` factory — inconsistent with the rest of the codebase.
  - Optimistic update in `useUpdateNote` only updates the list query, not any individual note query (none exists currently, but could become an issue).
- **Recommendations**:
  - Move `notesKeys` into `queryKeys` in `use-kanban.ts`.

### use-project-stats.ts
- **Lines**: 9
- **Quality**: 3.5/5
- **Pattern**: Derived hook that computes stats from issues query.
- **Issues Found**:
  - Only computes `issueCount`. The hook name implies broader statistics. This is either premature abstraction or a placeholder for future expansion.
  - Triggers a full issues fetch just to count them — if the project has many issues, this fetches all issue data for a single number.
- **Recommendations**:
  - Consider a dedicated lightweight API endpoint for project stats if this grows.
  - Or inline the count where needed instead of a separate hook.

### use-theme.ts
- **Lines**: 74
- **Quality**: 5/5
- **Pattern**: Module-level pub-sub with `useSyncExternalStore` — the correct modern React pattern for external state. Handles system preference changes. HMR-safe.
- **Issues Found**:
  - The system preference `change` listener (line 56) is never removed. Acceptable for a singleton but technically a leak.
- **Recommendations**: None significant. This is well-implemented.

---

## Event Bus

### event-bus.ts
- **Lines**: 299
- **Quality**: 4.5/5
- **Pattern**: Singleton `EventBus` class wrapping `EventSource` with per-issue handler dispatch, exponential backoff reconnection, heartbeat watchdog, and multiple listener types (issue events, issue-updated, changes-summary, activity, connection status).
- **Issues Found**:
  - **No query cache invalidation on reconnect**: The CLAUDE.md mentions "On reconnect: invalidates all React Query caches" but this logic is not in `event-bus.ts` itself. It must be handled by a consumer. If the consumer fails to set this up, reconnection after a long disconnect could show stale data.
  - **Handler cleanup gap**: If a subscriber throws during `dispatch` and the error is caught (line 250-253), iteration continues — correct. But if the `Set` is modified during iteration (a handler unsubscribes itself), this could cause subtle issues. In practice, `Set` iteration is snapshot-safe in V8.
  - **No max reconnect attempts**: The bus will retry forever with exponential backoff up to 30s. This is generally correct for a persistent connection, but a configurable max-attempts or user-visible "give up" state might improve UX for truly unreachable servers.
  - **Silent error swallowing**: All `catch` blocks are `/* ignore */`. While this prevents cascading failures, it makes debugging production issues harder. At minimum, errors in handler dispatch should be logged in development.
  - **No dedup of rapid reconnects**: If `onerror` fires multiple times quickly (e.g., during network flap), each call closes the EventSource and schedules a reconnect. The `if (this.es) return` guard in `connect()` prevents parallel connections, but multiple timers could queue up. The `reconnectTimer` check prevents this for sequential calls, but rapid `onerror` → `connect` → `onerror` cycles could theoretically race.
- **Recommendations**:
  - Add `console.warn` in development builds for swallowed handler errors.
  - Consider a connection state enum (`connecting`, `connected`, `reconnecting`, `disconnected`) instead of a boolean, for richer UI feedback.
  - Document where React Query cache invalidation on reconnect is wired up.

---

## API Client

### kanban-api.ts
- **Lines**: 496
- **Quality**: 4/5
- **Pattern**: Thin wrapper around `fetch` with typed request/response helpers (`get`, `post`, `patch`, `del`, `postFormData`). Consistent API envelope unwrapping.
- **Issues Found**:
  - **No AbortController support**: None of the API functions accept or propagate an `AbortSignal`. This means in-flight requests cannot be cancelled when components unmount or when React Query cancels queries. React Query passes `signal` to `queryFn` but the API client ignores it.
  - **Content-Type header on all requests**: The `request` function always sets `Content-Type: application/json`, even for GET and DELETE requests where it is unnecessary (harmless but slightly incorrect).
  - **`autoTitleIssue` breaks the pattern**: It uses raw `fetch` instead of the `post` helper, and its error handling (`res.ok` check + raw `res.json()`) differs from the envelope-based approach used everywhere else (lines 221-227).
  - **No request timeout**: Requests can hang indefinitely if the server is slow to respond. `fetch` does not have a built-in timeout.
  - **No retry logic**: Transient network errors are not retried. React Query provides retry at the hook level (`retry: 1` in the global config), which partially mitigates this.
  - Response types are defined inline rather than referencing shared types — some duplication with `@bkd/shared`.
- **Recommendations**:
  - Accept `signal?: AbortSignal` in the `request` function and pass it to `fetch`. React Query will automatically cancel stale requests.
  - Fix `autoTitleIssue` to use the `post` helper.
  - Consider adding a request timeout (e.g., 30s) via `AbortSignal.timeout()`.
  - Extract inline response types to shared types where they are used in multiple places.

---

## Utility Libraries

### format.ts
- **Lines**: 31
- **Quality**: 4.5/5
- **Pattern**: Pure formatting functions. No dependencies, no state.
- **Issues Found**:
  - `formatFileSize` does not handle GB+ sizes or negative values.
  - `formatModelName` only handles Claude model naming — other engines (Codex, Gemini) fall through to returning the raw ID, which may not be user-friendly.
- **Recommendations**: Add GB tier if needed. Otherwise fine.

### utils.ts
- **Lines**: 7
- **Quality**: 5/5
- **Pattern**: Standard `cn()` utility for Tailwind class merging.
- **Issues Found**: None.
- **Recommendations**: None.

### constants.ts
- **Lines**: 4
- **Quality**: 4/5
- **Pattern**: Language constants.
- **Issues Found**: Very minimal file — could be co-located with i18n config.
- **Recommendations**: None significant.

### statuses.ts
- **Lines**: 19
- **Quality**: 5/5
- **Pattern**: Status definitions with typed IDs and a lookup map. Mirrors backend config.
- **Issues Found**: None.
- **Recommendations**: None.

### shiki.ts
- **Lines**: 41
- **Quality**: 4.5/5
- **Pattern**: Lazy-loaded Shiki with singleton promise caching. Dual-theme support with graceful fallback to plain text.
- **Issues Found**:
  - `shikiPromise` is never reset on failure — if the initial import fails, all subsequent calls will also fail with the same rejected promise.
- **Recommendations**:
  - Reset `shikiPromise = null` on import failure so retries are possible.

### command-preview.ts
- **Lines**: 18
- **Quality**: 5/5
- **Pattern**: Pure function for truncating command strings.
- **Issues Found**: None.
- **Recommendations**: None.

### i18n-utils.ts
- **Lines**: 7
- **Quality**: 4/5
- **Pattern**: Single translation helper with fallback.
- **Issues Found**: Very thin utility — the function could be inlined where used.
- **Recommendations**: None significant.

---

## Critical Issues

1. **Missing AbortSignal propagation in API client** — React Query passes cancellation signals to `queryFn`, but `kanban-api.ts` ignores them. This means navigating away from a page while a slow request is in flight keeps the request alive, potentially applying stale data when it completes. **Impact**: Race conditions, wasted network resources, potential stale state application.

2. **`terminal-session-store` resource leak on reset** — Calling `reset()` without first closing the WebSocket and disposing the Terminal instance leaks resources. The store does not enforce cleanup order. **Impact**: WebSocket connections and xterm instances accumulate if terminal is opened/closed repeatedly.

## High Priority

3. **Unbounded `pathCache` in file-browser-store** — The `Map` grows without limit as users browse different project/issue combinations. Over long sessions, this accumulates stale entries. **Impact**: Memory growth proportional to unique contexts visited.

4. **Unbounded `seenIdsRef` / `seenContentKeysRef` in use-issue-stream** — These sets grow for the lifetime of an issue's stream subscription. For issues with thousands of log entries (long-running AI sessions), these sets become large. **Impact**: Memory pressure during long sessions.

5. **Code duplication across drawer stores** — 5 stores (terminal, notes, process-manager, panel, file-browser) share ~80% identical resize/open/close/minimize/fullscreen logic. Changes must be applied to all stores. **Impact**: Maintenance burden, risk of inconsistent behavior.

6. **`autoTitleIssue` breaks API client pattern** — Uses raw `fetch` instead of the `post` helper, with different error handling. **Impact**: Inconsistent error handling, missing envelope unwrapping.

## Medium Priority

7. **`use-kanban.ts` is 976 lines** — Covers too many domains in a single file. **Impact**: Difficult to navigate and maintain.

8. **Helper duplication between `use-chat-messages` and `use-acp-timeline`** — `entryId`, `hasResultFlag`, `isToolUseAction`, `isToolUseResult`, `buildToolGroup` are duplicated. **Impact**: Bug fixes must be applied in two places.

9. **`useSystemLogs` does not include `lines` param in query key** — Different callers requesting different line counts share the same cache. **Impact**: Incorrect cached data if multiple callers exist with different line counts.

10. **`shikiPromise` never reset on failure** — A failed dynamic import permanently breaks syntax highlighting. **Impact**: Syntax highlighting unavailable for the rest of the session after a transient load failure.

11. **SSE reconnect does not invalidate React Query caches in EventBus** — Cache invalidation on reconnect is expected (per documentation) but not implemented in the EventBus itself. Must be wired up by a consumer. **Impact**: Stale data displayed after reconnection if consumer setup is missed.

12. **`useRestartWithUpgrade` polling is not cancellable** — The `setTimeout` chain cannot be aborted on unmount. **Impact**: Continued polling and potential `window.location.reload()` after the component is gone.

## Low Priority

13. **`notesKeys` defined separately from `queryKeys`** — Inconsistent key management pattern.

14. **`use-mobile` initial render returns `false`** — Brief flash of desktop layout on mobile.

15. **`use-click-outside` uses `mousedown` instead of `pointerdown`** — Misses touch-originated events on some platforms.

16. **Silent error swallowing in EventBus** — All handler errors are silently caught. Hinders debugging.

17. **`getIssueUrl` in server-store uses `window.location.origin`** — Not testable, ignores configured server URL.

18. **Resize listeners on drawer stores are never cleaned up** — Global `addEventListener('resize')` calls are never removed. Acceptable for singletons but prevents cleanup in tests.

19. **`use-project-stats` fetches all issues to count them** — Over-fetching for a simple count. Currently only returns `issueCount`.

20. **`formatFileSize` does not handle GB+ sizes** — Edge case for very large files.
