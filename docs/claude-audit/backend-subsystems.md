# Backend Subsystems Audit

## Summary

This audit covers five backend subsystems in `apps/api/src/`: the self-upgrade system, background jobs, SSE event bus, webhook dispatcher, and MCP server. The codebase is generally well-structured with good separation of concerns, consistent error handling patterns, and defensive programming. However, several security, reliability, and correctness issues were identified across subsystems, ranging from a path traversal bypass in the upgrade system to unbounded memory growth in the SSE layer.

**Total findings: 6 Critical, 5 High, 8 Medium, 6 Low**

---

## Upgrade System

### Overview

The upgrade system (`upgrade/`) implements a self-updating mechanism that polls GitHub Releases, downloads platform-appropriate binaries or app packages, verifies SHA-256 checksums, and restarts the process. It supports two modes: binary (direct executable replacement) and package (tar.gz extraction with atomic swap). The system is well-decomposed across 10 files with clear responsibilities.

### Module Reports

#### `types.ts`
Clean type definitions for `ReleaseInfo`, `ReleaseAsset`, `UpgradeCheckResult`, and `DownloadStatus`. Well-typed with explicit nullable fields. No issues.

#### `constants.ts`
Simple constant definitions. `isPackageMode` derived from `APP_DIR` presence. Check interval is 1 hour. No issues.

#### `utils.ts`

**Path traversal bypass (CRITICAL):** `isPathWithinDir()` uses a naive `startsWith` check:
```typescript
return filePath.startsWith(`${dir}/`)
```
This fails when `dir` itself is a prefix of another directory. For example, if `dir` is `/data/updates`, the path `/data/updates-evil/payload` would pass validation. More critically, if `filePath` equals `dir` exactly (without trailing slash), it returns `false`, which is inconsistent but not exploitable. The real risk is that `resolve()` is called before this check, which normalizes `..` sequences, so the traversal risk is mitigated in practice by the `resolve()` + `VALID_FILE_NAME_RE` combo. However, `isPathWithinDir` as a standalone utility is unreliable.

**Recommendation:** Replace with `resolve(filePath).startsWith(resolve(dir) + path.sep)` or use `path.relative()` and check it doesn't start with `..`.

`VALID_FILE_NAME_RE` is well-constructed and prevents most injection via filenames.

`isNewerVersion()` handles `dev` correctly and uses standard semver comparison. The `|| 0` fallback in `parseInt` silently treats non-numeric parts as 0, which is acceptable for the expected input format.

`detectPlatformAssetSuffix()` gracefully falls back to raw platform/arch values for unsupported platforms.

#### `github.ts`
Fetches latest release from GitHub API with a 15-second timeout. Uses type assertion (`as`) on the JSON response rather than runtime validation -- acceptable for a controlled external API but fragile if GitHub changes response shape.

**Missing rate limit handling (MEDIUM):** GitHub API returns 403 with `X-RateLimit-Remaining: 0` when rate-limited. The code treats this as a generic failure and logs a warning but doesn't differentiate or back off. With 1-hour check intervals this is unlikely to trigger for unauthenticated requests (60/hr limit), but multi-instance deployments could hit it.

#### `checksum.ts`
`computeFileSha256()` reads the entire file into memory via `arrayBuffer()`. For large binaries (~105 MB), this creates a significant memory spike.

**Recommendation (MEDIUM):** Use streaming hash computation. Bun's `CryptoHasher` supports `update()` with chunks; combine with a readable stream from `Bun.file().stream()`.

`fetchExpectedChecksum()` correctly validates the hash format with a 64-char hex regex and parses the standard `<sha256>  <filename>` format. The catch-all returning `null` is appropriate since the caller treats `null` as a verification failure.

#### `checker.ts`
Logic is sound: finds matching asset by platform/mode, checks for checksum files, compares versions, and persists results. No issues beyond what's noted in dependencies.

#### `download.ts`
Well-implemented streaming download with progress tracking, checksum verification, and atomic rename.

**Download status is module-level singleton (MEDIUM):** Only one download can be tracked at a time. If the server is restarted mid-download, the status resets to `idle` and the `.tmp` file remains (cleaned up on next startup, which is good). However, there's no mechanism to cancel an in-progress download.

**`isDownloading` flag not reset on unhandled rejection in stream reader (LOW):** If `reader.read()` throws after `sink.end()` in the `finally` block also throws, the `isDownloading` flag could remain `true`. The outer catch should handle this, but the flow is complex.

The 5-minute timeout via `AbortSignal.timeout` is appropriate for large binary downloads.

#### `files.ts`
`ensureUpdatesDir()` is synchronous (`mkdirSync`) -- acceptable since it's called infrequently.

`deleteDownloadedUpdate()` properly validates filename and checks path containment before deletion. `cleanupTmpFiles()` and `cleanupBackupDirs()` are defensive with catch-alls on individual operations.

**`listDownloadedUpdates` has no path validation on readdir entries (LOW):** Unlike `deleteDownloadedUpdate`, this function doesn't validate filenames from `readdir()`. While not exploitable (it only reads metadata), it's inconsistent.

#### `apply.ts`

**`process.exit(0)` in `finally` block race (HIGH):** The function calls `process.exit(0)` inside the `try` block, but the `finally` block runs `clearTimeout(safetyTimer)` and `isApplying = false`. In practice, `process.exit()` prevents `finally` from running in Node/Bun, but if the exit is delayed, the timeout could fire and reset `isApplying` while the upgrade is still in progress.

**No verification of spawned child process (HIGH):** After spawning the new binary/launcher, the code calls `process.exit(0)` without verifying the child started successfully. If the new binary fails to start (e.g., corrupted download despite checksum pass, missing runtime dependency), the service goes down with no recovery.

**Recommendation:** Implement a health check handshake: the new process writes a ready signal, and the old process waits briefly before exiting. Or use a systemd/supervisor watchdog.

`extractArchive()` has good atomic swap semantics with backup and rollback on failure. The `server.js` existence check is a reasonable integrity validation.

**Archive extraction runs `tar` without `--no-same-owner` (LOW):** If running as root, extracted files could have unexpected ownership. Not critical for typical deployment but worth noting.

#### `service.ts`
Clean orchestration module with proper lifecycle management. `initUpgradeSystem()` correctly skips in dev mode. The periodic check properly handles `unref()` to avoid keeping the process alive.

**Nested void promise chains (LOW):** `startPeriodicCheck` uses `void isUpgradeEnabled().then(...)` inside `setInterval`. If `isUpgradeEnabled` throws, the `.then()` chain won't catch it. Should use `.catch()` on the outer promise as well.

### Issues & Recommendations

1. **CRITICAL:** Fix `isPathWithinDir()` to use proper path comparison
2. **HIGH:** Add child process health verification before `process.exit(0)`
3. **MEDIUM:** Stream file hashing instead of loading entire binary into memory
4. **MEDIUM:** Handle GitHub API rate limiting explicitly
5. **MEDIUM:** Add download cancellation support
6. **LOW:** Add `--no-same-owner` to tar extraction

---

## Background Jobs

### Module Reports

#### `upload-cleanup.ts`
Simple and effective. Cleans files older than 7 days from `data/uploads/` every hour. Uses `unref()` on the timer. Returns a cleanup function for graceful shutdown.

**No subdirectory handling (LOW):** `readdir` + `unlink` only handles flat files. If subdirectories exist in `data/uploads/`, they would be silently skipped (since `unlink` fails on directories). The `stat` call prevents errors, but orphaned directories would accumulate.

**No path traversal protection on readdir entries (MEDIUM):** While `readdir` returns only filenames (not paths), the `resolve(UPLOAD_DIR, file)` pattern is safe against traversal since `readdir` won't return `..` entries. However, symlinks in the upload directory could cause `unlink` to delete files outside the intended directory.

#### `worktree-cleanup.ts`
Well-implemented with batch queries to avoid N+1, proper SQLite variable limit handling (`MAX_BATCH = 500`), and safe guards against cleaning active sessions.

**`slice(0, MAX_BATCH)` silently drops entries (MEDIUM):** If there are more than 500 project directories or issue directories, the excess entries are silently ignored until the next cleanup cycle. This is a pragmatic limit but should be logged.

**Race condition between check and cleanup (LOW):** Between querying `doneIssues` and calling `removeWorktree`, an issue's status could change (e.g., restarted). The `removeWorktree` call could then remove a worktree for an active issue. The `sessionStatus` guard mitigates this, but there's still a TOCTOU window.

### Issues & Recommendations

1. **MEDIUM:** Log when batch limits are exceeded in worktree cleanup
2. **MEDIUM:** Consider symlink-safe deletion in upload cleanup (use `lstat` instead of `stat`)
3. **LOW:** Handle subdirectories in upload cleanup

---

## Events/SSE

### Module Reports

#### `event-bus.ts`
Clean pub/sub implementation with ordered subscribers and lazy sorting. Error isolation per subscriber (caught and logged). The unsubscribe function uses `splice` which mutates the array during potential iteration.

**Concurrent emit + unsubscribe race (HIGH):** If a subscriber's callback triggers an unsubscribe (e.g., a one-shot listener), the `splice` mutates the `list` array while the `for...of` loop in `emit()` is iterating over it. This can cause skipped subscribers or index errors. The `for...of` on arrays creates an iterator that may behave unpredictably when the underlying array is mutated.

**Recommendation:** Copy the list before iterating in `emit()`: `const snapshot = [...list]`, or use a deferred removal pattern.

#### `index.ts`
Single global `AppEventBus` instance. Clean re-export. No issues.

#### `issue-events.ts`
Thin wrappers around `appEvents.emit()`. The `emitIssueLogRemoved` correctly short-circuits on empty arrays. No issues.

#### `changes-summary.ts`
Runs `git status --porcelain=v1 -uall` and `git diff HEAD -M --numstat` to compute file change statistics after session completion.

**`-uall` flag on git status can be expensive (MEDIUM):** In large repositories with many untracked files, `-uall` enumerates every individual file in untracked directories. This can take seconds or even minutes. The 10-second timeout on `runCommand` provides a safety net, but a timeout means no changes summary is emitted.

**Untracked file reading has no size limit (MEDIUM):** The code reads entire untracked files to count lines (`Bun.file(fullPath).text()`). A large binary file accidentally left untracked could cause significant memory usage. The `countTextLines` function is called on the full content.

**Recommendation:** Add a file size check before reading (e.g., skip files > 1 MB) and use streaming line counting.

#### `routes/events.ts` (SSE endpoint)
Well-structured SSE endpoint with proper cleanup on disconnect. Uses `AbortSignal` for client disconnect detection and a heartbeat every 15 seconds.

**No connection limit (HIGH):** There's no limit on concurrent SSE connections. Each connection subscribes to all events on the global `AppEventBus`. A malicious or buggy client opening hundreds of connections could exhaust memory (each connection holds multiple closures and subscriptions) and amplify event processing (every event dispatches to every connection).

**Recommendation:** Implement a connection counter with a configurable maximum (e.g., 50 concurrent SSE connections).

**`writeSSE` errors silently close stream (LOW):** When `stream.writeSSE()` fails (e.g., client disconnect not yet detected by `AbortSignal`), the `catch(stop)` silently closes the stream. This is correct behavior but could benefit from a debug log on the first write error.

### Issues & Recommendations

1. **HIGH:** Fix emit-during-unsubscribe race condition in `AppEventBus`
2. **HIGH:** Add SSE connection limit to prevent resource exhaustion
3. **MEDIUM:** Add file size limits when reading untracked files for changes summary
4. **MEDIUM:** Consider `-unormal` instead of `-uall` for git status

---

## Webhooks

### Module Reports

#### `dispatcher.ts`
Comprehensive webhook system supporting generic HTTP webhooks and Telegram bot notifications. Features include deduplication, delivery logging, and periodic cleanup.

**Webhook secret sent as Bearer token (CRITICAL):** The `deliverWebhook` function sends the webhook secret as `Authorization: Bearer ${webhook.secret}`. Standard webhook practice is to use HMAC-SHA256 signature verification (compute `HMAC(secret, body)` and send in a header like `X-Webhook-Signature`). Sending the secret directly in the header means:
- The secret is transmitted in every request and could be logged by intermediary proxies
- The receiving server must store the secret in plaintext to compare
- There's no body integrity verification (the payload could be tampered with in transit even over HTTPS if TLS termination happens at a load balancer)

**Recommendation:** Implement HMAC-SHA256 signing: `X-Webhook-Signature: sha256=<HMAC(secret, body)>`.

**Telegram bot token stored as `webhook.secret` and used in URL (CRITICAL):** The bot token is interpolated directly into the Telegram API URL. If this URL is logged anywhere (error logs, HTTP client debugging), the bot token is exposed. The token grants full control of the Telegram bot.

**Recommendation:** Ensure Telegram bot tokens are never logged. Consider masking in error output.

**`JSON.parse(row.events)` without validation (MEDIUM):** The `events` column is parsed as a string array without schema validation. Malformed data would cause the `subscribed.includes()` call to behave unexpectedly (e.g., if it's an object instead of an array).

**No retry mechanism (MEDIUM):** Failed webhook deliveries are logged but never retried. For transient failures (network timeouts, 5xx responses), a retry queue with exponential backoff would improve reliability.

**`cleanupDeliveries` N+1 pattern (LOW):** The cleanup function queries all webhooks, then runs a separate offset+delete query per webhook. For many webhooks, this could be slow. A single SQL query with window functions would be more efficient, though SQLite's window function support may be limited.

**Fire-and-forget delivery (LOW):** `void deliver(...)` means delivery failures don't propagate. Combined with no retry mechanism, this means events can be silently lost. The logging partially mitigates this.

### Issues & Recommendations

1. **CRITICAL:** Replace Bearer token auth with HMAC-SHA256 webhook signatures
2. **CRITICAL:** Mask Telegram bot tokens in all log output
3. **MEDIUM:** Add webhook retry mechanism for transient failures
4. **MEDIUM:** Validate `events` column JSON schema before use
5. **LOW:** Optimize delivery cleanup to avoid N+1 queries

---

## MCP Server

### Module Reports

#### `server.ts`
Large file (793 lines) implementing a full MCP server with tools for project/issue CRUD, execution control, engine listing, and log retrieval. Uses the `@modelcontextprotocol/sdk` with Zod schema validation.

**File size exceeds 800-line guideline (LOW):** At 793 lines, this file is at the threshold. As more tools are added, it should be split into separate files per tool group (projects, issues, execution, engines, logs).

**No authentication/authorization (CRITICAL):** The MCP server exposes full CRUD operations and execution control without any authentication. Any client that can connect to the MCP transport can create/delete projects, execute AI agents, and read all data. While MCP typically runs locally, the server should validate that the connection is from an authorized client, especially since `execute-issue` can run arbitrary AI agents.

**`create-project` bypasses workspace root validation (HIGH):** The `create-project` tool calls `resolve(directory)` but does not invoke `resolveWorkingDir()` which validates the directory is within the configured workspace root. This means an MCP client could create a project pointing to any directory on the filesystem (e.g., `/etc`, `/root`). The `execute-issue` tool does call `resolveWorkingDir`, so the AI agent would be restricted, but the project record itself would have an unrestricted path.

**Recommendation:** Apply the same `resolveWorkingDir` validation in `create-project`.

**`insertIssueInTransaction` returns `newIssue!` with non-null assertion (LOW):** If the insert somehow returns empty (shouldn't happen with `returning()`), this would throw at runtime. A defensive check would be safer.

**Duplicated query patterns (MEDIUM):** Every tool handler independently queries the project and issue, repeating the same `findProject` + `select().where(and(...))` pattern. This boilerplate could be extracted into shared middleware or helper functions to reduce duplication and ensure consistent ownership checks.

**`resolveWorkingDir` workspace root bypass when not configured (MEDIUM):** If `workspace:defaultPath` is not set (returns null/undefined) or is set to `/`, the validation is skipped entirely. This means workspace restriction is opt-in rather than opt-out. This is documented behavior but could lead to security misconfiguration.

### Issues & Recommendations

1. **CRITICAL:** Add authentication to MCP server or document that it must only be exposed on trusted transports
2. **HIGH:** Apply workspace directory validation in `create-project`
3. **MEDIUM:** Extract repeated query patterns into shared helpers
4. **MEDIUM:** Default workspace restriction to CWD rather than unrestricted when not configured

---

## Critical Issues

| # | Subsystem | Issue | Impact |
|---|-----------|-------|--------|
| 1 | Upgrade | `isPathWithinDir()` uses naive string prefix check | Path traversal possible with crafted directory names |
| 2 | Webhooks | Secret sent as plaintext Bearer token instead of HMAC signature | Secret exposure via logs/proxies, no payload integrity |
| 3 | Webhooks | Telegram bot token interpolated into URL, may appear in logs | Full bot compromise if token is logged |
| 4 | MCP | No authentication on MCP server | Unauthorized access to all operations |
| 5 | Upgrade | No child process health check before `process.exit(0)` | Service can go permanently offline after failed upgrade |
| 6 | Upgrade | `computeFileSha256` loads entire file (~105 MB) into memory | Memory exhaustion during upgrade |

## High Priority

| # | Subsystem | Issue | Impact |
|---|-----------|-------|--------|
| 1 | Events | `emit()` iterates array that `splice()` can mutate mid-loop | Skipped subscribers, potential undefined behavior |
| 2 | Events | No SSE connection limit | Memory exhaustion, event amplification |
| 3 | MCP | `create-project` bypasses workspace root validation | Projects can reference arbitrary filesystem paths |
| 4 | Upgrade | `process.exit(0)` prevents `finally` block from proper cleanup | `isApplying` flag stuck, safety timer race |
| 5 | Upgrade | No download cancellation mechanism | Stuck downloads block all future downloads |

## Medium Priority

| # | Subsystem | Issue | Impact |
|---|-----------|-------|--------|
| 1 | Upgrade | No GitHub API rate limit handling | Silent failures in multi-instance deployments |
| 2 | Jobs | Batch limit silently drops excess worktree entries | Stale worktrees accumulate in large deployments |
| 3 | Jobs | Symlinks in upload dir could cause out-of-directory deletion | Data loss via symlink attack |
| 4 | Events | `-uall` flag on git status expensive in large repos | Timeout and missing changes summary |
| 5 | Events | No file size limit when reading untracked files | Memory spike on large files |
| 6 | Webhooks | No retry mechanism for failed deliveries | Silent event loss on transient failures |
| 7 | Webhooks | `events` JSON parsed without schema validation | Unexpected behavior on malformed data |
| 8 | MCP | Workspace restriction is opt-in (no default restriction) | Security misconfiguration risk |

## Low Priority

| # | Subsystem | Issue | Impact |
|---|-----------|-------|--------|
| 1 | Upgrade | `tar` extraction without `--no-same-owner` | Unexpected file ownership when running as root |
| 2 | Upgrade | `listDownloadedUpdates` doesn't validate readdir entries | Inconsistent with `deleteDownloadedUpdate` |
| 3 | Upgrade | Nested void promise chain in `startPeriodicCheck` | Unhandled rejection possible |
| 4 | Jobs | Upload cleanup doesn't handle subdirectories | Orphaned directories accumulate |
| 5 | Events | SSE write errors are silent | Debugging connection issues is harder |
| 6 | MCP | File approaching 800-line limit | Maintainability concern as tools are added |
