# Backend Core Audit

## Summary

The backend core of BKD is well-structured and production-ready. Code quality is generally high with consistent patterns, proper error handling, and thoughtful defensive programming. The codebase shows maturity in areas like PID locking (multi-signal verification), graceful shutdown, and database initialization. Key concerns center on: (1) the in-process cache lacking concurrency safety for async operations, (2) minor security gaps in file uploads and SQL construction, (3) some functions being unnecessarily async, and (4) a few areas where error information could leak in edge cases. Overall, the codebase is well-maintained with clear separation of concerns.

---

## Module Reports

### app.ts
- **Lines**: 81
- **Quality**: 5/5
- **Issues Found**:
  - None significant. Clean, focused middleware setup.
- **Recommendations**:
  - The compression skip check (`c.req.path.endsWith('/stream')`) is brittle -- any future non-SSE route ending in `/stream` would bypass compression unintentionally. Consider maintaining an explicit Set of SSE paths.
  - The global error handler correctly avoids leaking internal error details to clients (returns generic "Internal server error"). Good practice.

### config.ts
- **Lines**: 22
- **Quality**: 5/5
- **Issues Found**:
  - None. Clean, minimal configuration with proper typing.
- **Recommendations**:
  - Consider freezing `STATUSES` and `STATUS_MAP` with `Object.freeze()` / making the array `as const` to prevent accidental mutation at runtime, though the current `readonly`-by-convention approach is acceptable.

### cache.ts
- **Lines**: 89
- **Quality**: 3/5
- **Issues Found**:
  1. **Unnecessary async**: All exported functions (`cacheGet`, `cacheSet`, `cacheDel`, `cacheDelByPrefix`, `cacheGetOrSet`) are declared `async` but perform only synchronous Map operations. This adds unnecessary microtask overhead on every call.
  2. **Race condition in `cacheGetOrSet`**: Two concurrent calls with the same key will both call `fetcher()` because there is no deduplication/locking. This can cause duplicate expensive operations (e.g., DB queries, HTTP probes).
  3. **`cacheGet` returns `null` for falsy cached values**: If a legitimate cached value is `null`, `undefined`, `false`, or `0`, it will be treated as a cache miss (line 49: `value ?? null`). The `cacheGetOrSet` function is particularly affected -- it re-fetches whenever the cached value is `null`.
  4. **LRU eviction sorts entire access map**: `evictLRU()` copies and sorts all entries on every `cacheSet` call when the cache is full. With 500 entries this is acceptable, but the O(n log n) sort on every write is suboptimal compared to a proper LRU linked-list structure.
- **Recommendations**:
  - Remove `async` from all cache functions or document that the async signature exists for future extensibility (e.g., Redis migration).
  - Add a pending-fetcher Map to `cacheGetOrSet` to deduplicate concurrent fetches for the same key (thundering herd protection).
  - Use a sentinel value or a wrapper object `{ value: T }` to distinguish "not in cache" from "cached null".
  - Consider using a battle-tested LRU library (e.g., `lru-cache`) if performance matters at scale.

### logger.ts
- **Lines**: 29
- **Quality**: 4/5
- **Issues Found**:
  1. **No log rotation**: The log file grows unbounded. `pino.destination(logFile)` creates a single file with no size limit or rotation.
  2. **HTTP logger logs at `debug` level**: In production with `LOG_LEVEL=info` (the default), no HTTP requests are logged at all. This means request logging is effectively disabled by default.
  3. **No request ID or timing**: The HTTP logger does not include request duration or a correlation ID, making it harder to trace slow requests.
- **Recommendations**:
  - Use `pino.transport()` with `pino-roll` or an external log rotation solution.
  - Change HTTP logging to `info` level for non-health routes, or make the level configurable separately.
  - Add request duration (capture `Date.now()` before `await next()`).
  - Consider adding a request ID header (`X-Request-Id`) for distributed tracing.

### index.ts
- **Lines**: 215
- **Quality**: 4/5
- **Issues Found**:
  1. **Shutdown timeout missing**: The `shutdown()` function calls `await issueEngine.cancelAll()` without a timeout. If engine cancellation hangs, the process never exits (until the second signal force-exits).
  2. **Static file serving order**: The three `serveStatic` middleware registrations (lines 101-131) are ordered correctly but rely on Hono's middleware fall-through behavior. A comment explaining why three separate `app.use` calls are needed (assets vs. general vs. SPA fallback) would aid maintainability.
  3. **`process.exit(0)` in shutdown**: Calling `process.exit(0)` immediately after `logger.info('server_stopped')` may not give pino enough time to flush logs (unlike the uncaughtException handler which has a 200ms delay).
- **Recommendations**:
  - Add a shutdown timeout (e.g., 10 seconds) after which the process force-exits.
  - Add a short delay before `process.exit(0)` to allow log flushing, similar to the `uncaughtException` handler.
  - Consider consolidating the three static-serving strategies (embedded, package, dev) into a single factory function for clarity.

### pid-lock.ts
- **Lines**: 327
- **Quality**: 5/5
- **Issues Found**:
  - None significant. This is one of the best-written modules in the codebase. The multi-signal PID verification (kill, procfs, HTTP probe) is thorough and well-documented.
- **Recommendations**:
  - The `isBkdByProcfs` check matches both `'bkd'` and `'bun'` in cmdline. In environments where other Bun applications run, this could produce false positives. Consider making the keyword configurable or checking for a more specific marker.
  - Minor: `HTTP_PROBE_TIMEOUT_MS` is 2000ms but is divided by 1000 when passed to curl's `--max-time` (line 81), making it effectively a 2s timeout. The variable name suggests milliseconds but the actual usage is seconds -- this is not a bug but could cause confusion.

### static-assets.ts
- **Lines**: 8
- **Quality**: 5/5
- **Issues Found**:
  - None. Correctly serves as a build-time replaceable stub.
- **Recommendations**:
  - None.

### embedded-static.ts
- **Lines**: 63
- **Quality**: 5/5
- **Issues Found**:
  - None. Clean middleware with proper cache control differentiation between hashed and non-hashed assets.
- **Recommendations**:
  - Consider adding `ETag` or `Last-Modified` headers for non-hashed assets to enable conditional requests.

### root.ts
- **Lines**: 34
- **Quality**: 4/5
- **Issues Found**:
  1. The `ROOT_DIR` resolution assumes `import.meta.dir` is always 3 levels deep (`../../..`). If the file is ever moved, this silently produces a wrong root directory.
- **Recommendations**:
  - Add a startup sanity check (e.g., verify `package.json` exists at `ROOT_DIR`) to fail fast on misconfiguration.

### uploads.ts
- **Lines**: 54
- **Quality**: 3/5
- **Issues Found**:
  1. **Path traversal via file name**: `extname(file.name)` is used directly in the stored file path (line 23). While the base name is a ULID (safe), a malicious `file.name` with embedded path separators in the extension (e.g., `foo./../../../etc/passwd`) could theoretically cause issues depending on `extname` behavior. In practice, `extname` returns `.passwd` for that input, so the risk is minimal, but the file name is not sanitized.
  2. **No MIME type validation**: The `mimeType` is taken directly from `file.type` without validation. There is no allowlist of permitted file types.
  3. **`UPLOAD_DIR` uses `process.cwd()`**: Unlike other path resolutions that use `ROOT_DIR`, `UPLOAD_DIR` uses `process.cwd()`, which could differ if the process is started from a different directory.
  4. **No total upload size limit**: Individual files are capped at 10MB and count at 10, but there is no aggregate size check (100MB total per request is allowed).
- **Recommendations**:
  - Sanitize file extensions to allow only alphanumeric characters and a single dot.
  - Use `ROOT_DIR` instead of `process.cwd()` for `UPLOAD_DIR` consistency.
  - Consider adding MIME type allowlist validation.
  - Consider adding an aggregate size limit.

### version.ts
- **Lines**: 3
- **Quality**: 5/5
- **Issues Found**:
  - None. Minimal compile-time injectable version info.
- **Recommendations**:
  - The `declare` for `__BITK_VERSION__` and `__BITK_COMMIT__` is missing in this file (it relies on ambient declarations). Adding explicit `declare const __BITK_VERSION__: string` would improve type safety and editor support.

### db/index.ts
- **Lines**: 137
- **Quality**: 4/5
- **Issues Found**:
  1. **SQL injection in schema verification**: Line 97 uses string interpolation in a PRAGMA query: `` `PRAGMA table_info('${table}')` ``. While `table` comes from Drizzle schema metadata (not user input), this is a dangerous pattern. If a schema table name ever contained a quote, it would break. Use parameterized queries or at minimum validate the table name.
  2. **Migration error swallowing**: The `runMigrations` function catches errors where the message matches "already exists" and silently continues (line 52). This could mask legitimate migration failures that happen to contain that string.
  3. **Foreign keys disabled during migration without try/finally**: Lines 41-53 disable foreign keys before migration and re-enable after. If `migrate()` throws an error that is NOT the "already exists" pattern, foreign keys are re-enabled in the catch block, which is correct. However, the pattern of manually managing this state is fragile.
  4. **`process.exit(1)` in `verifySchema`**: Hard process exit makes this module untestable in isolation.
- **Recommendations**:
  - Use `sqlite.query('PRAGMA table_info(?)').all(table)` or validate table names against `[a-zA-Z0-9_]+`.
  - Make the "already exists" error detection more specific (e.g., check the exact Drizzle migration error type).
  - Consider throwing an error from `verifySchema` instead of calling `process.exit` directly, and let the caller handle it.

### db/schema.ts
- **Lines**: 213
- **Quality**: 5/5
- **Issues Found**:
  - None significant. Well-structured schema with proper indexes, foreign keys, and constraints.
- **Recommendations**:
  - The `totalCostUsd` field is stored as `text` (line 69). While this avoids floating-point precision issues, it requires careful parsing everywhere it is read. Consider documenting the expected format (e.g., decimal string with fixed precision).
  - The `parentIssueId` self-reference uses `(): any => issues.id` (line 57) to work around TypeScript circular reference limitations. This is a known Drizzle pattern but the `any` cast suppresses type checking.

### db/embedded-migrations.ts
- **Lines**: 8
- **Quality**: 5/5
- **Issues Found**:
  - None. Build-time replaceable stub, same pattern as `static-assets.ts`.
- **Recommendations**:
  - None.

### db/reset.ts
- **Lines**: 34
- **Quality**: 4/5
- **Issues Found**:
  1. **Duplicated DB path resolution**: The `rawDbPath` / `dbPath` logic (lines 5-6) is identical to `db/index.ts`. This violates DRY and could drift.
  2. **No confirmation prompt**: This script deletes all database files without user confirmation. While it is a developer tool, accidental invocation could cause data loss.
- **Recommendations**:
  - Extract DB path resolution into a shared utility function.
  - Consider adding a `--yes` flag requirement or interactive confirmation.

### db/pending-messages.ts
- **Lines**: 335
- **Quality**: 4/5
- **Issues Found**:
  1. **Dynamic `import('ulid')` in `upsertPendingMessage`**: Line 94 uses a dynamic import for `ulid` despite it being a static dependency already used in `schema.ts`. This adds unnecessary overhead on every call.
  2. **Repeated JSON.parse of metadata**: The pattern `JSON.parse(row.metadata!)` with `try/catch` appears 7+ times across the file. This should be extracted to a helper.
  3. **Mixed sync/async transaction usage**: `relocatePendingForProcessing` uses a synchronous `db.transaction()` (line 202) while other functions use `db.transaction(async (tx) => ...)`. The sync variant is correct here (all operations are synchronous Drizzle calls), but the inconsistency may confuse maintainers.
  4. **Attachment file cleanup missing**: `deletePendingMessage` deletes DB records for attachments but does not delete the actual files from disk. This creates orphaned files that rely on the periodic upload cleanup job.
- **Recommendations**:
  - Use a static import for `ulid`.
  - Extract a `parseMetadata(raw: string | null): Record<string, unknown>` helper.
  - Document the intentional sync vs async transaction choice.
  - Consider deleting attachment files in `deletePendingMessage` or document that the upload cleanup job handles orphans.

### db/helpers.ts
- **Lines**: 351
- **Quality**: 4/5
- **Issues Found**:
  1. **`backfillSortOrders` is O(n) sequential updates**: Each issue/project gets its own `UPDATE` query (lines 303-306, 332-335). For large datasets, this could be slow. A single transaction with batched updates would be more efficient.
  2. **Dynamic imports in `ensureDefaultFilterRules` and `ensureWorktreeAutoCleanupDefault`**: These use `await import(...)` for modules that could be statically imported, adding latency on first call.
  3. **SQL `LIKE` pattern in `getAllEngineDefaultModels`**: Line 122 uses `LIKE 'engine:%:defaultModel'` where `%` is the wildcard but `:` is not escaped. This works correctly because `:` is not a LIKE special character, but the pattern could match unintended keys if naming conventions change (e.g., `engine:foo:bar:defaultModel`).
- **Recommendations**:
  - Wrap `backfillSortOrders` updates in a transaction for atomicity and performance.
  - Use static imports where possible.
  - Consider using a structured key format or prefix scan instead of LIKE patterns.

### utils/date.ts
- **Lines**: 4
- **Quality**: 4/5
- **Issues Found**:
  1. **Ambiguous number interpretation**: When `v` is a number, it is multiplied by 1000 (assuming Unix seconds). If a caller passes milliseconds, the result will be wrong (year ~65000+). There is no validation or documentation of the expected input format.
- **Recommendations**:
  - Add JSDoc documenting that numeric input must be Unix epoch seconds.
  - Consider adding a range check to detect millisecond timestamps passed by mistake.

### utils/git.ts
- **Lines**: 27
- **Quality**: 5/5
- **Issues Found**:
  - None. Clean, focused utility with appropriate caching.
- **Recommendations**:
  - None.

### utils/changes.ts
- **Lines**: 44
- **Quality**: 5/5
- **Issues Found**:
  - None. Good path-traversal protection via `isPathInsideRoot`. The implementation correctly handles trailing separator edge cases.
- **Recommendations**:
  - None.

---

## Critical Issues

None found. The codebase has no critical security vulnerabilities or data-corruption risks in the audited files.

---

## High Priority

1. **Cache `cacheGetOrSet` thundering herd** (`cache.ts`): Concurrent calls for the same key will all execute the fetcher function simultaneously. This can cause duplicate expensive operations (DB queries, HTTP probes) and inconsistent results. Add a pending-Promise map to deduplicate in-flight fetches.

2. **SQL string interpolation in schema verification** (`db/index.ts:97`): `PRAGMA table_info('${table}')` uses string interpolation. While the table name comes from Drizzle metadata (not user input), this pattern is dangerous as a precedent and should use parameterized queries or validation.

3. **HTTP request logging disabled by default** (`logger.ts`): The HTTP logger uses `debug` level, but the default log level is `info`. This means no HTTP requests are logged in production unless the operator explicitly sets `LOG_LEVEL=debug`, which would flood logs with all debug output.

---

## Medium Priority

4. **No shutdown timeout** (`index.ts`): The graceful shutdown awaits `issueEngine.cancelAll()` without a deadline. A hung engine process could prevent the server from ever exiting. Add a `Promise.race` with a timeout (e.g., 10 seconds).

5. **No log flushing delay on clean shutdown** (`index.ts:206`): `process.exit(0)` is called immediately after the final log statement. The `uncaughtException` handler correctly delays 200ms for log flushing, but the normal shutdown path does not.

6. **`UPLOAD_DIR` uses `process.cwd()`** (`uploads.ts:5`): All other path resolutions use `ROOT_DIR` from `root.ts`. Using `process.cwd()` here creates an inconsistency that could cause uploads to go to the wrong directory if the process is started from a non-standard location.

7. **Cache returns null for legitimate falsy values** (`cache.ts:49`): `value ?? null` means cached `null`, `undefined`, `false`, and `0` values are treated as cache misses. `cacheGetOrSet` will re-execute the fetcher for these values on every call.

8. **Unnecessary async signatures in cache** (`cache.ts`): All cache functions are declared `async` but perform only synchronous operations. This adds microtask scheduling overhead on every cache access across the entire application.

9. **Dynamic import of `ulid` in `upsertPendingMessage`** (`db/pending-messages.ts:94`): Uses `await import('ulid')` when `ulid` is already a static dependency of the project. Replace with a static import.

10. **Duplicated DB path resolution** (`db/reset.ts` vs `db/index.ts`): The `rawDbPath`/`dbPath` derivation logic is copy-pasted between two files. Extract to a shared utility to prevent drift.

---

## Low Priority

11. **Compression skip check is path-suffix based** (`app.ts:18`): `c.req.path.endsWith('/stream')` could unintentionally match non-SSE routes. An explicit path Set would be safer.

12. **No file extension sanitization** (`uploads.ts:23`): While ULID-based filenames mitigate most risks, the file extension is taken directly from user input without sanitization.

13. **`backfillSortOrders` lacks transaction wrapping** (`db/helpers.ts`): Sequential per-row UPDATE queries without a transaction could leave sort orders partially assigned if the process crashes mid-backfill.

14. **`toISO` numeric input ambiguity** (`utils/date.ts`): No documentation or validation that numeric input must be Unix seconds (not milliseconds).

15. **`procfs` BKD detection false positives** (`pid-lock.ts:66`): Matching `'bun'` in `/proc/<pid>/cmdline` could match any Bun application, not just BKD.

16. **Repeated `JSON.parse(row.metadata!)` pattern** (`db/pending-messages.ts`): The same try/catch JSON parse pattern appears 7+ times. Extract to a `parseMetadata` helper.

17. **`ROOT_DIR` relies on fixed directory depth** (`root.ts:25`): `resolve(import.meta.dir, '../../..')` assumes the file is exactly 3 levels deep. Moving the file would silently break root detection. Add a sanity check.

18. **Log file grows unbounded** (`logger.ts:19`): No log rotation configured. In long-running deployments, the log file will grow without limit.

19. **Missing `declare const` for compile-time globals** (`version.ts`): `__BITK_VERSION__` and `__BITK_COMMIT__` lack explicit declarations in the file, relying on ambient type definitions.
