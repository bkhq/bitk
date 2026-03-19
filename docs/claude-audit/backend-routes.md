# Backend Routes Audit

## Summary

Audited **35 route files** across `apps/api/src/routes/` covering projects, issues (12 sub-modules), engines, events, files, filesystem, git, terminal, worktrees, processes, notes, MCP, and settings (7 sub-modules).

**Overall assessment**: The codebase demonstrates strong engineering practices. Input validation via Zod is consistently applied on mutation endpoints, the API response envelope is uniform, soft-delete is used everywhere, and there is meaningful security hardening (path traversal guards, SSRF prevention, symlink resolution, workspace sandboxing). The main areas for improvement are the absence of authentication/authorization middleware, missing rate limiting, and a few validation gaps on read-only endpoints.

**Scoring legend**: Quality 1 (poor) - 5 (excellent)

---

## Module Reports

### routes/api.ts
- **Lines**: 165
- **Quality**: 5
- **Validation**: adequate
- **Security**: Good. `/runtime` endpoint gated behind `ENABLE_RUNTIME_ENDPOINT` env var. `execPath` stripped from signals to avoid binary path leakage. Process info (pid, ppid, cwd) still exposed on `/status` — acceptable for admin tooling but noted.
- **Recommendations**:
  - Consider gating `/status` similarly to `/runtime`, or at least requiring authentication, since it leaks memory usage and DB health details.
  - The route index itself exposes `process.cwd()` — harmless for local tools, but could be an information leak on a shared server.

### routes/index.ts
- **Lines**: 5
- **Quality**: 5
- **Validation**: N/A (re-export only)
- **Security**: No issues
- **Recommendations**: None

### routes/projects.ts
- **Lines**: 397
- **Quality**: 5
- **Validation**: adequate — Zod schemas for create/update with length limits, regex on alias, env vars capped at 10000 chars per value.
- **Security**: Directory normalization via `resolve()` prevents basic traversal. Duplicate directory check prevents project aliasing attacks. Cache invalidation is thorough.
- **Recommendations**:
  - `uniqueAlias()` has an unbounded loop (lines 85-96). While practically unlikely to loop many times, adding a max iteration guard (e.g., 100) would be safer.
  - `envVars` schema uses `z.record(z.string(), z.string().max(10000))` but does not limit the number of keys. A malicious client could send thousands of keys. Add `.refine(obj => Object.keys(obj).length <= 50)` or similar.
  - The `GET /` endpoint calls `checkProjectGitRepo()` for every project in the list, issuing `stat()` + `git` subprocess per row. This could be slow with many projects and has no pagination.
  - No rate limiting on project creation.

### routes/engines.ts
- **Lines**: 180
- **Quality**: 5
- **Validation**: adequate — `engineTypeOrAcpEnum` custom refine validates engine type strings, Zod on all PATCH bodies, hidden models regex-validated.
- **Security**: No direct file/process access; delegates to safe DB helpers and probed executors.
- **Recommendations**:
  - `POST /probe` triggers live engine probes with no rate limiting. A client could spam this endpoint to thrash system resources.
  - The `/:engineType/models` endpoint reflects `rawType` back in the error message (`Unknown engine type: ${rawType}`). While Zod-validated, the reflected string is user-supplied. Not exploitable in JSON context but consider using a generic message.

### routes/events.ts
- **Lines**: 127
- **Quality**: 5
- **Validation**: N/A (SSE stream, no input)
- **Security**: No auth check on SSE stream — any client can subscribe to all issue events across all projects. This is the single biggest information leak surface in the API.
- **Recommendations**:
  - **[CRITICAL]** Add project-scoping or authentication to `/api/events`. Currently any HTTP client can read all log entries, state changes, and file diffs across all projects.
  - Consider per-project SSE endpoints or requiring a project filter query parameter.
  - The heartbeat interval (15s) is appropriate. AbortSignal cleanup is correct.

### routes/files.ts
- **Lines**: 337
- **Quality**: 5
- **Validation**: partial — `root` query param validated for presence but not format (no max length). File path extracted from URL with `decodeURIComponent` fallback. Save body parsed via `c.req.json()` without Zod schema.
- **Security**: Strong. Path traversal mitigated with `isInsideRoot()` on all operations. Symlink traversal prevented via `verifyRealPath()` on write/delete ops. Binary detection prevents accidental display. Content size limit (5 MB) on save. Root directory deletion blocked.
- **Recommendations**:
  - `handleSave` parses JSON body manually (`c.req.json()`) instead of using `zValidator`. Add Zod schema for the save body.
  - `handleShow` for directory listings does not cap entry count — a directory with millions of files would produce a massive response. Consider adding pagination or a limit.
  - Read operations (`handleShow`, `handleRaw`) do not verify symlinks via `verifyRealPath()` — only write/delete do. A symlink in the root tree could let a client read files outside root. **[MEDIUM priority]**
  - The `root` query parameter accepts any path on the filesystem. When `workspace:defaultPath` is not set, this grants read/write access to the entire filesystem.

### routes/filesystem.ts
- **Lines**: 98
- **Quality**: 4
- **Validation**: adequate — `createDirSchema` validates name length and basename check prevents traversal.
- **Security**: Workspace root enforcement via `isInsideRoot()`. Directory name validated against `basename()` to prevent path traversal via `..` injection.
- **Recommendations**:
  - `GET /dirs` falls back to `process.cwd()` when no workspace root is configured, which means directory listing works on the entire filesystem. This is by design for a local tool but risky if exposed on a network.
  - When workspace root is `/`, all path restrictions are disabled (line 23). This is intentional but should be documented as a security trade-off.
  - Error on `readdir` failure returns `{ success: true, data: { dirs: [] } }` — silently swallowing errors. Consider returning a 500 or at least a warning flag.

### routes/git.ts
- **Lines**: 91
- **Quality**: 4
- **Validation**: adequate — `detectRemoteSchema` validates directory string.
- **Security**: The `directory` parameter is `resolve()`-d but not validated against workspace root. A client can probe any directory on the filesystem for git remote URLs.
- **Recommendations**:
  - **[HIGH]** Add workspace root validation to `POST /detect-remote`, consistent with the workspace sandboxing in `filesystem.ts` and `files.ts`.
  - The `normalizeGitUrl()` function is straightforward but does not sanitize the URL beyond regex matching. If a malicious `.git/config` contains crafted URLs, they would be passed through.

### routes/terminal.ts
- **Lines**: 358
- **Quality**: 5
- **Validation**: adequate — Resize validated via Zod (int, min/max bounds). WS binary protocol validates message type byte and col/row bounds.
- **Security**: App-specific env vars stripped from PTY environment (`TERMINAL_STRIP_KEYS`). Session limit enforced (10 max). 24h expiry on sessions. Grace period prevents DoS via rapid WS connect/disconnect.
- **Recommendations**:
  - Terminal provides full shell access — if the API is network-exposed without auth, this is a remote code execution vector. **[CRITICAL]** Must be auth-gated.
  - `POST /terminal` creates sessions without authentication. Rate limiting is absent.
  - The WebSocket upgrade path (`/terminal/ws/:id`) checks session existence but relies on `crypto.randomUUID()` for session ID — not guessable, but also not authenticated.
  - Consider adding an option to restrict terminal cwd to the workspace root.

### routes/worktrees.ts
- **Lines**: 128
- **Quality**: 5
- **Validation**: adequate — `VALID_ID` regex prevents path traversal in issueId. `resolve()` + startsWith check on worktree path.
- **Security**: Multi-layer path validation (regex + resolve + startsWith) prevents directory traversal. Project ownership verified via `findProject`.
- **Recommendations**:
  - Minor: The `!` non-null assertion on `c.req.param('projectId')` (line 68) is safe due to route definition but could use optional chaining for defensive coding.

### routes/processes.ts
- **Lines**: 117
- **Quality**: 5
- **Validation**: adequate — project ownership verified for both GET and POST.
- **Security**: Issue ownership verified via cross-project join. Process termination scoped to owned issues.
- **Recommendations**:
  - `POST /:issueId/terminate` returns 400 for all errors, even when 500 would be more appropriate for internal failures.

### routes/notes.ts
- **Lines**: 80
- **Quality**: 4
- **Validation**: adequate — Zod schemas with max lengths on title (500) and content (100,000).
- **Security**: No auth. Notes are global (not project-scoped), so any client can read/modify all notes.
- **Recommendations**:
  - PATCH endpoint does not validate that at least one field is provided — an empty `{}` body would trigger an `UPDATE ... SET updatedAt = ...` with no meaningful change. Harmless but wasteful.
  - The `isPinned` field in PATCH is typed as `z.boolean()` in Zod but the DB likely stores it as an integer. Verify Drizzle handles the conversion.

### routes/mcp.ts
- **Lines**: 159
- **Quality**: 5
- **Validation**: adequate — middleware checks enabled state + API key/localhost gate.
- **Security**: Strong. Localhost detection uses `getConnInfo()` (Bun's actual client IP, not spoofable via headers) with URL hostname fallback. API key auth via Bearer token. Session TTL (30 min) and size cap (100) prevent resource exhaustion.
- **Recommendations**:
  - API key comparison uses `!==` (strict equality) which is not timing-safe. Use `crypto.timingSafeEqual()` to prevent timing attacks. **[MEDIUM]**
  - `@ts-nocheck` at the top disables all type checking. Document why this is necessary and remove when the upstream SDK issue is resolved.
  - The `catch` block on `getConnInfo()` falls back to URL hostname, which could be spoofed via Host header. Add a comment noting this limitation.

### routes/issues/index.ts
- **Lines**: 30
- **Quality**: 5
- **Validation**: N/A (routing aggregator)
- **Security**: No issues
- **Recommendations**: None

### routes/issues/_shared.ts
- **Lines**: 326
- **Quality**: 5
- **Validation**: adequate — Comprehensive Zod schemas for create, update, bulk, execute, and follow-up operations. Model regex validated. Permission modes enum-constrained.
- **Security**: Workspace root validation in `triggerIssueExecution()`. Pending message lifecycle handles failure recovery (restores visibility on error).
- **Recommendations**:
  - `normalizePrompt()` uses regex `^(?:\\n|\s)+` which matches literal `\n` strings. The intent seems to be trimming whitespace/newlines. Verify this is correct — `\s` already matches `\n`.
  - `parseTags()` catches JSON parse errors and falls back to treating raw string as a single tag. This is defensive but could mask data corruption.
  - `triggerIssueExecution()` is fire-and-forget (`void (async () => ...)()`) — errors are logged but the caller never knows. Consider tracking failures more explicitly.
  - `parseProjectEnvVars()` uses `JSON.parse()` with an `as` cast. Add runtime validation of the parsed object shape.

### routes/issues/query.ts
- **Lines**: 101
- **Quality**: 5
- **Validation**: partial — `parentId` query param is not validated for format/length. Raw string directly used in DB query.
- **Security**: Project ownership verified. Soft-delete filter applied.
- **Recommendations**:
  - Add length/format validation on the `parentId` query parameter (should match nanoid 8-char pattern).
  - No pagination on the issues list endpoint. Large projects could return thousands of issues in a single response.

### routes/issues/create.ts
- **Lines**: 191
- **Quality**: 5
- **Validation**: adequate — uses `createIssueSchema` with full Zod validation.
- **Security**: Parent issue ownership validated within transaction. Project ownership verified.
- **Recommendations**:
  - The `catch` block (line 171) returns a generic `Failed to create issue` 400 error, even for `Parent issue not found` throws. The parent validation errors from the transaction get swallowed. Consider catching specific error messages.
  - Webhook payload construction includes `project.name` — if names contain sensitive info, this could leak through webhooks.

### routes/issues/update.ts
- **Lines**: 332
- **Quality**: 5
- **Validation**: adequate — `updateIssueSchema` and `bulkUpdateSchema` with proper constraints.
- **Security**: Project ownership verified for both single and bulk updates. Circular parent reference prevented. Depth-1 constraint enforced.
- **Recommendations**:
  - Bulk update iterates inside a transaction with individual queries per update. For large batches (up to 1000), this could be slow. Consider batched SQL updates for sort-order-only changes.
  - Cache invalidation after bulk update uses sequential `await cacheDel()` calls. Could be parallelized with `Promise.all()`.

### routes/issues/delete.ts
- **Lines**: 106
- **Quality**: 5
- **Validation**: adequate — project and issue ownership verified.
- **Security**: Process termination with timeout prevents hanging on delete. Child issues cascade-deleted within transaction.
- **Recommendations**:
  - The 5-second timeout on process termination is hardcoded. Consider making it configurable.
  - Webhook dispatch after deletion includes `existing.title` — verify this is safe for the webhook consumer.

### routes/issues/command.ts
- **Lines**: 248
- **Quality**: 5
- **Validation**: adequate — `executeIssueSchema` with Zod validation. Prompt normalized and checked for emptiness.
- **Security**: Workspace root validation via `getAppSetting`. Directory existence verified before execution.
- **Recommendations**:
  - Error log at line 137 says `issue_followup_failed` but this is the execute route — should be `issue_execute_failed`.
  - `POST /:id/restart` has no Zod body validation. While it currently reads no body, adding an empty schema would be explicit.
  - `resolvedDir` is included in the error message at line 83 (`Failed to create project directory: ${resolvedDir}`). This leaks the absolute server path to the client.

### routes/issues/message.ts
- **Lines**: 369
- **Quality**: 4
- **Validation**: partial — multipart form data is validated manually (not via Zod). JSON path uses Zod via `followUpSchema`. File validation delegated to `validateFiles()`.
- **Security**: Model change rejected during active session. Pending message recall validates ULID format. File upload handled through dedicated upload module.
- **Recommendations**:
  - `parseFollowUpBody()` for multipart does not validate prompt length (`max(32768)` is only in the Zod JSON path). A multipart request could submit an arbitrarily long prompt. **[MEDIUM]**
  - `displayPrompt` from multipart is not length-validated (the Zod schema has `.max(500)` but multipart path skips this).
  - The `catch` in the follow-up error path (lines 299-326) attempts to save as pending but if that also fails, it returns a generic 400 error with no indication that the message was lost.
  - Dynamic `import()` at line 348 (`await import('@/db/pending-messages')`) should be a static import for consistency with the rest of the file which already imports from the same module.

### routes/issues/logs.ts
- **Lines**: 212
- **Quality**: 5
- **Validation**: adequate — filter path parsed and validated with whitelisted keys. Turn ranges validated. Entry types checked against whitelist. Pagination clamped (1-1000).
- **Security**: Project and issue ownership verified.
- **Recommendations**:
  - `parsePagination()` makes an async DB call (`getAppSetting`) on every request when `limit` is not provided. Consider caching the page size setting.
  - The `queryAndRespond` function takes `issue` parameter typed as the return of `getProjectOwnedIssue` (nullable) but uses `issue!` non-null assertion. The caller has already null-checked, so this is safe but could use a non-null type.

### routes/issues/attachments.ts
- **Lines**: 60
- **Quality**: 5
- **Validation**: adequate — project and issue ownership verified, attachment ownership verified via issueId join.
- **Security**: Path traversal prevention via `startsWith` check against normalized upload dir. Forced download via `Content-Disposition: attachment`. `X-Content-Type-Options: nosniff` prevents MIME sniffing.
- **Recommendations**:
  - The `mimeType` from the DB is set as `Content-Type` directly. If a malicious file was uploaded with a crafted MIME type (e.g., `text/html`), the `Content-Disposition: attachment` header should prevent browser rendering, but adding a CSP header or restricting to safe MIME types would add defense in depth.

### routes/issues/changes.ts
- **Lines**: 284
- **Quality**: 5
- **Validation**: adequate — path validated against injection (`-` prefix, `:` character). Path containment validated via `isPathInsideRoot()`.
- **Security**: Strong. Multiple path injection vectors blocked (dash-prefix for git flag injection, colon for git revision syntax). Symlink-safe path check. `previousPath` also validated.
- **Recommendations**:
  - `git status --porcelain=v1 -uall` (line 71) could be slow in repositories with many untracked files. Consider adding a file count limit.
  - `summarizeFileLines()` reads untracked file content via `Bun.file().text()`. No size limit on the file being read — a very large untracked file could cause memory issues.

### routes/issues/title.ts
- **Lines**: 64
- **Quality**: 5
- **Validation**: adequate — project and issue ownership verified.
- **Security**: No direct user input beyond issue/project IDs.
- **Recommendations**:
  - Error response at line 56 includes `error.message` directly from the engine exception. This could leak internal details. Use a generic message.

### routes/issues/duplicate.ts
- **Lines**: 145
- **Quality**: 5
- **Validation**: adequate — project and issue ownership verified.
- **Security**: All data copied within a transaction. New IDs generated for all copied records.
- **Recommendations**:
  - Large issues with thousands of logs could cause a very long transaction. Consider adding a log count limit or running the copy outside the transaction with eventual consistency.
  - Tool calls are copied individually inside a loop — batch inserts would improve performance.

### routes/issues/review.ts
- **Lines**: 38
- **Quality**: 5
- **Validation**: adequate — read-only, filters by status and soft-delete flags.
- **Security**: Filters out deleted projects and issues.
- **Recommendations**:
  - This is a cross-project endpoint (`/api/issues/review`) — it returns issues from all projects. In a multi-tenant scenario this would be an IDOR. For a single-user local tool this is acceptable.
  - No pagination — could return a large result set.

### routes/issues/export.ts
- **Lines**: 147
- **Quality**: 5
- **Validation**: adequate — `exportQuerySchema` validates format enum via Zod. Query parameter validation.
- **Security**: Project and issue ownership verified.
- **Recommendations**:
  - `getAllLogs()` uses synchronous `.all()` which blocks the event loop for large result sets. Consider using async pagination.
  - `JSON.parse(row.metadata)` and `JSON.parse(tool.raw)` have no error handling individually (line 36, 49). While wrapped in `.map()`, a corrupt row would crash the entire export. Add try-catch per row.
  - No response size limit — exporting a large issue could produce a multi-MB response.

### routes/settings/index.ts
- **Lines**: 21
- **Quality**: 5
- **Validation**: N/A (routing aggregator)
- **Security**: No issues
- **Recommendations**: None

### routes/settings/general.ts
- **Lines**: 434
- **Quality**: 5
- **Validation**: adequate — Zod schemas on all PATCH endpoints. Workspace path validated for existence and directory type. Write filter rules validated per-rule with regex constraints.
- **Security**: Workspace path is resolved via `resolve()` before storage.
- **Recommendations**:
  - `PATCH /server-info` accepts a `url` field with only `z.string().max(1024)` validation. No URL format validation — a malicious value could be stored and used later by webhook URL construction.
  - `GET /mcp` returns the full API key in the response. Consider masking it (show only last 4 chars) like the webhook secret handling.
  - `PATCH /mcp` accepts `apiKey` with `z.string().max(256)` but no minimum length. An empty-after-trim key is treated as "delete", which is correct, but a 1-char API key would be accepted.
  - The `slash-commands` endpoint dynamically imports and calls `refreshSlashCommandsCache()` on cache miss — this could be triggered repeatedly by a client to cause resource usage.

### routes/settings/about.ts
- **Lines**: 44
- **Quality**: 5
- **Validation**: N/A (read-only)
- **Security**: Exposes `process.pid`, Bun version, platform, arch, and node version. Acceptable for admin tooling.
- **Recommendations**:
  - `startedAt` is captured at module load time as `Date.now()`. This is correct but means the timestamp survives hot module reloads in dev.

### routes/settings/webhooks.ts
- **Lines**: 330
- **Quality**: 5
- **Validation**: adequate — comprehensive Zod schemas. URL protocol validation (http/https only). SSRF prevention via `isPrivateHost()` blocking private ranges, link-local, cloud metadata, and loopback addresses.
- **Security**: Strong. Secret masking in responses. Channel-specific validation (Telegram bot token required, chat ID numeric). Private network URL blocking prevents SSRF.
- **Recommendations**:
  - `isPrivateHost()` does not block DNS rebinding (a hostname that resolves to a private IP). For full SSRF prevention, the actual resolved IP should be checked at delivery time. **[MEDIUM]**
  - The update schema does not re-validate URL protocol/host when `url` is provided. The validation is done manually in the handler (lines 195-213) which is correct but duplicates logic from the create schema.
  - `SECRET_MASK` comparison (`body.secret !== SECRET_MASK`) is fragile — if a client happens to send the exact mask string as a new secret value, it would be ignored. Consider using a separate `clearSecret: true` field.
  - Webhook deliveries endpoint (`GET /webhooks/:id/deliveries`) returns raw `payload` and `response` fields which could contain sensitive data.

### routes/settings/cleanup.ts
- **Lines**: 444
- **Quality**: 4
- **Validation**: adequate — cleanup targets validated via enum array.
- **Security**: Cleanup operations are destructive (hard-delete from DB, recursive `rm`). No confirmation mechanism or undo capability.
- **Recommendations**:
  - `cleanupLogs()` calls `db.run(sql\`VACUUM\`)` synchronously (line 317). VACUUM on a large SQLite DB can be slow and blocks all other operations. Consider `PRAGMA incremental_vacuum` or running it in a separate connection.
  - `getDirSize()` recursively traverses directories with no depth limit. A deeply nested directory structure could cause stack overflow.
  - `cleanupWorktrees()` falls back to `rm -rf` when `removeWorktree()` fails (line 384). This could delete non-worktree directories if the scan produced false positives.
  - No rate limiting — a client could trigger cleanup repeatedly.

### routes/settings/upgrade.ts
- **Lines**: 197
- **Quality**: 5
- **Validation**: adequate — Download URLs restricted to GitHub domains. File names validated via regex. Checksums enforced.
- **Security**: Strong. `ALLOWED_DOWNLOAD_HOSTS` whitelist prevents downloading from arbitrary URLs. File name regex prevents path traversal in download filenames. In-progress download check prevents race conditions.
- **Recommendations**:
  - `POST /restart` triggers a full server restart with no confirmation mechanism. Consider requiring a confirmation token or recent download verification.
  - Error responses from `/restart` include the raw `err.message` which could leak internal paths.

### routes/settings/recycle-bin.ts
- **Lines**: 93
- **Quality**: 5
- **Validation**: adequate — issue ID validated via Zod (min 1, max 32). Existence and soft-delete status verified.
- **Security**: Parent project existence verified before restore. Cascade restore of soft-deleted parent project.
- **Recommendations**:
  - No pagination on `GET /deleted-issues`. A large number of deleted issues would produce a massive response.
  - Restore does not check if restoring would violate uniqueness constraints (e.g., issue number conflicts).

### routes/settings/system-logs.ts
- **Lines**: 77
- **Quality**: 4
- **Validation**: partial — `lines` query param parsed via `Number()` with fallback but not validated for NaN or negative values. Clamped to 1-5000 which handles most cases.
- **Security**: Log file path is hardcoded (not user-controlled). Download endpoint serves the raw log file.
- **Recommendations**:
  - `POST /system-logs/clear` truncates the log file with no confirmation or audit trail. Consider at least logging the clear action before truncating.
  - Log file content could contain sensitive information (request paths, error details). The download endpoint has no authentication.
  - The `totalLines` estimate for large files (line 43-46) is a rough approximation that could be misleading.

---

## Critical Issues

1. **No authentication/authorization layer**: The entire API has no auth middleware. Every endpoint — including terminal (RCE), file operations (read/write/delete), process management, settings modification, and upgrade/restart — is accessible to any client that can reach the server. This is the most significant security gap.
   - Files: `routes/terminal.ts`, `routes/files.ts`, `routes/events.ts`, all settings routes
   - Impact: Remote code execution (terminal), arbitrary file read/write, data exfiltration
   - Mitigation: The app appears designed as a local development tool, but if exposed on a network (even a LAN), these risks are real.

2. **SSE event stream leaks all data**: `GET /api/events` broadcasts all issue logs, state changes, and change summaries across all projects with no filtering or authentication.
   - File: `routes/events.ts`

## High Priority

3. **`POST /api/git/detect-remote` bypasses workspace sandbox**: Unlike `filesystem.ts` and `files.ts`, the git route does not validate the `directory` parameter against the workspace root. A client can probe any directory for git remote URLs.
   - File: `routes/git.ts`, line 33-34

4. **No rate limiting on any endpoint**: Resource-intensive operations (engine probes, cleanup, file operations, terminal creation) have no rate limiting. A malicious or buggy client can exhaust server resources.
   - All route files

5. **Terminal endpoint is unauthenticated RCE**: `POST /terminal` creates a full shell session. Combined with the lack of auth, this is a remote code execution vector.
   - File: `routes/terminal.ts`

## Medium Priority

6. **MCP API key comparison is not timing-safe**: The Bearer token comparison uses `!==` which leaks key length/content via timing side-channel.
   - File: `routes/mcp.ts`, line 128

7. **Multipart form data validation gap in follow-up**: The multipart path in `parseFollowUpBody()` does not enforce prompt length limit (32768) or displayPrompt length limit (500) that the Zod JSON path enforces.
   - File: `routes/issues/message.ts`, lines 56-101

8. **Read operations in files.ts do not verify symlinks**: `handleShow` and `handleRaw` check `isInsideRoot()` on the logical path but do not call `verifyRealPath()` to follow symlinks. A symlink within the root could point outside it.
   - File: `routes/files.ts`, lines 113-245

9. **DNS rebinding not addressed in webhook SSRF prevention**: `isPrivateHost()` only checks hostnames, not resolved IPs. A hostname that resolves to 127.0.0.1 bypasses the check.
   - File: `routes/settings/webhooks.ts`, line 13-29

10. **MCP settings endpoint returns full API key**: `GET /api/settings/mcp` returns the complete API key without masking. Other settings (webhook secrets) properly mask secrets.
    - File: `routes/settings/general.ts`, lines 344-371

## Low Priority

11. **`uniqueAlias()` has no iteration cap**: Theoretical infinite loop if all alias variants are taken.
    - File: `routes/projects.ts`, lines 82-96

12. **Error log message mismatch**: Execute route logs `issue_followup_failed` instead of `issue_execute_failed`.
    - File: `routes/issues/command.ts`, line 137

13. **File path leaked in error messages**: `command.ts` line 83 includes `resolvedDir` in client-facing error. `title.ts` line 56 includes raw `error.message`.
    - Files: `routes/issues/command.ts`, `routes/issues/title.ts`

14. **`envVars` schema has no key count limit**: `z.record(z.string(), z.string().max(10000))` accepts unlimited keys.
    - File: `routes/projects.ts`, line 23

15. **No pagination on multiple list endpoints**: `GET /projects`, `GET /issues`, `GET /deleted-issues`, `GET /issues/review` all return unbounded result sets.
    - Files: `routes/projects.ts`, `routes/issues/query.ts`, `routes/settings/recycle-bin.ts`, `routes/issues/review.ts`

16. **Synchronous `.all()` in export blocks event loop**: `getAllLogs()` uses synchronous DB query for potentially large result sets.
    - File: `routes/issues/export.ts`, lines 16-69

17. **VACUUM blocks all DB operations**: Cleanup route calls `db.run(sql\`VACUUM\`)` which locks the entire database for the duration.
    - File: `routes/settings/cleanup.ts`, line 317

18. **Dynamic import in message.ts**: `deletePendingMessage` is dynamically imported at line 348 despite other symbols from the same module being statically imported at the top.
    - File: `routes/issues/message.ts`, line 348

19. **`handleSave` uses manual JSON parsing**: Should use `zValidator` for consistency with the rest of the codebase.
    - File: `routes/files.ts`, lines 293-295

20. **SECRET_MASK comparison is fragile**: If a client sends the exact mask string as a webhook secret, the update is silently ignored.
    - File: `routes/settings/webhooks.ts`, line 227
