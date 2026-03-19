# Security Cross-Cutting Review

**Date:** 2026-03-19
**Scope:** Full codebase security audit of `/app/ai/bkd/` covering hardcoded secrets, injection risks, authentication, authorization, and data handling.

---

## Summary

The codebase demonstrates strong security awareness in several areas: path traversal prevention with `isInsideRoot()` and symlink resolution, DOMPurify sanitization on all `dangerouslySetInnerHTML` usages, SHA-256 checksum verification on downloads, safe environment variable filtering for child processes, and Drizzle ORM parameterized queries throughout. However, **the API has no authentication or authorization by default**, which is the most significant finding. The application is designed as a local development tool, but given it exposes terminal access, file system operations, and command execution, this lack of authentication is a critical risk when network-accessible.

---

## 1. Hardcoded Secrets, API Keys, Tokens

### Status: PASS

| # | Severity | Finding |
|---|----------|---------|
| SEC-01 | PASS | **No hardcoded secrets found.** All API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`) are read from environment variables. |
| SEC-02 | PASS | **`.gitignore` excludes `.env` files** (`.env`, `.env.local`, `.env.*.local`). |
| SEC-03 | PASS | **Safe environment filtering.** `engines/safe-env.ts` uses an explicit allowlist of environment variables passed to child engine processes, preventing leakage of `DB_PATH`, `API_SECRET`, etc. |
| SEC-04 | PASS | **Terminal PTY env stripping.** `routes/terminal.ts` strips sensitive keys (`API_SECRET`, `ALLOWED_ORIGIN`, `DB_PATH`, etc.) from the environment before spawning shell processes. |
| SEC-05 | LOW | **Webhook secrets stored in plaintext in SQLite.** The `webhooks.secret` column stores webhook API keys and Telegram bot tokens as plaintext. These are sensitive credentials. Consider encrypting at rest with an application-level key. |
| SEC-06 | LOW | **Project `envVars` stored as plaintext JSON.** The `projects.env_vars` column stores environment variable key-value pairs (which may contain secrets) as unencrypted JSON text in the database. |

---

## 2. SQL Injection

### Status: PASS

| # | Severity | Finding |
|---|----------|---------|
| SEC-07 | PASS | **All database queries use Drizzle ORM.** Queries use `eq()`, `and()`, `inArray()`, and parameterized `sql` tagged templates. No string concatenation for SQL. |
| SEC-08 | LOW | **One unparameterized PRAGMA query.** In `db/index.ts:97`: `sqlite.query(\`PRAGMA table_info('${table}')\`)`. The `table` variable comes from Drizzle schema metadata (not user input), so this is not exploitable, but it violates the principle of always parameterizing. Note: PRAGMA does not support parameterized table names in SQLite, so this is a known limitation. |
| SEC-09 | PASS | **Launcher DB repair uses parameterized inserts.** Migration SQL is read from trusted files and applied via `sqlite.run()`. The `INSERT INTO __drizzle_migrations` uses parameterized values. |

---

## 3. XSS Risks

### Status: PASS (with caveat)

| # | Severity | Finding |
|---|----------|---------|
| SEC-10 | PASS | **All `dangerouslySetInnerHTML` usages sanitized.** Four occurrences found, all wrapped in `DOMPurify.sanitize()`: `ShikiCodeBlock.tsx:35`, `FileViewer.tsx:260`, `MarkdownContent.tsx:136`, `CodeRenderers.tsx:120`. |
| SEC-11 | MEDIUM | **ESLint rule `react-dom/no-dangerously-set-innerhtml` is disabled.** While current usages are safe, future additions will not be flagged. This removes an important safety net. See also E-1 in the build audit. |
| SEC-12 | PASS | **Attachment downloads force `Content-Disposition: attachment`.** File serving in `attachments.ts` uses `attachment` disposition and `X-Content-Type-Options: nosniff`, preventing content-sniffing XSS. |

---

## 4. Command Injection

### Status: PASS (with design note)

| # | Severity | Finding |
|---|----------|---------|
| SEC-13 | PASS | **All subprocess spawning uses array-based arguments.** `Bun.spawn()`, `spawnNode()`, and `runCommand()` all accept `string[]` rather than shell strings. No `shell: true` usage found. This prevents command injection via argument manipulation. |
| SEC-14 | HIGH | **Terminal WebSocket provides full shell access.** `routes/terminal.ts` spawns a login shell (`-l`) and exposes it via WebSocket. This is an intentional feature for a development tool, but combined with the lack of authentication (SEC-16), any network client can get a full shell. The session limit (10) provides minimal DoS protection but no access control. |
| SEC-15 | PASS | **Git commands use array-based spawning.** `routes/git.ts` uses `runCommand(['git', ...args], { cwd })` with validated directory paths. The `directory` input is validated with Zod (`z.string().min(1).max(1000)`) and resolved via `resolve()`. |

---

## 5. Path Traversal

### Status: PASS

| # | Severity | Finding |
|---|----------|---------|
| SEC-16 | PASS | **File browser has comprehensive path validation.** `routes/files.ts` implements `isInsideRoot()` checks on all operations. Write/delete operations additionally call `verifyRealPath()` which resolves symlinks and verifies the real path stays within root. |
| SEC-17 | PASS | **Filesystem directory browser validates workspace boundary.** `routes/filesystem.ts` restricts traversal to the configured workspace root via `isInsideRoot()`. |
| SEC-18 | PASS | **Attachment serving validates path prefix.** `routes/issues/attachments.ts` verifies the resolved path starts with the upload directory before serving. |
| SEC-19 | PASS | **Upgrade download validates file names.** `upgrade/utils.ts` uses `VALID_FILE_NAME_RE` regex and `isPathWithinDir()` to prevent path traversal in download file names. |
| SEC-20 | PASS | **Launcher validates version directory paths.** `scripts/launcher.ts` checks `tmpFile.startsWith(dataDir)` and `versionDir.startsWith(appBase)` before extraction. |
| SEC-21 | LOW | **Read operations in `files.ts` do not verify symlinks.** While write/delete operations call `verifyRealPath()`, the `handleShow()` and `handleRaw()` read handlers only check logical path containment via `isInsideRoot()`. A symlink inside the root pointing outside could be read. Consider adding symlink verification to read operations as well. |

---

## 6. SSRF Risks

### Status: LOW RISK

| # | Severity | Finding |
|---|----------|---------|
| SEC-22 | LOW | **Webhook dispatcher sends requests to user-configured URLs.** `webhooks/dispatcher.ts` fetches arbitrary URLs configured by the user for webhook delivery. An attacker with access to the webhook settings could configure internal network URLs to perform SSRF. Mitigated by: (a) the application is a local dev tool, (b) requests have a 10s timeout, (c) response body is truncated to 1KB. |
| SEC-23 | PASS | **Upgrade downloads restricted to GitHub.** The upgrade system only fetches from `api.github.com/repos/bkhq/bkd/releases`. The launcher additionally restricts downloads to `github.com` and `objects.githubusercontent.com` via `ALLOWED_HOSTS`. |

---

## 7. Authentication & Authorization

### Status: CRITICAL GAP

| # | Severity | Finding |
|---|----------|---------|
| SEC-24 | **CRITICAL** | **No authentication on the main API.** The Hono application (`app.ts`) has no authentication middleware. All API routes, including destructive operations (file delete, issue execute, terminal spawn), are accessible to any client that can reach the server. The `API_SECRET` and `ALLOWED_ORIGIN` environment variables are referenced in terminal strip keys but are not actually enforced as middleware anywhere in the codebase. |
| SEC-25 | MEDIUM | **MCP endpoint has authentication but it is optional.** `routes/mcp.ts` implements API key authentication with localhost fallback. When no API key is configured, only localhost requests are allowed (verified via client IP, not Host header -- good). However, the MCP endpoint is disabled by default, requiring explicit opt-in. |
| SEC-26 | MEDIUM | **No project-level access control.** All API consumers can access all projects. There is no concept of users, roles, or permissions. While acceptable for a single-user dev tool, this becomes a concern if the server is exposed to a team. |
| SEC-27 | INFO | **Terminal sessions use UUID-based IDs.** Session IDs are generated with `crypto.randomUUID()` which provides sufficient entropy. However, knowing a session ID grants full terminal access without further authentication. |

---

## 8. CORS Configuration

### Status: NOT CONFIGURED

| # | Severity | Finding |
|---|----------|---------|
| SEC-28 | HIGH | **No CORS middleware configured.** The Hono app does not use `hono/cors` middleware. Browsers will apply same-origin policy by default, but the server does not set `Access-Control-Allow-Origin` headers. This means: (a) legitimate cross-origin clients cannot connect, (b) malicious pages cannot make credentialed cross-origin requests (browsers block by default). However, simple GET/POST requests with `Content-Type: application/json` will be sent by browsers even without CORS headers (preflight is required only for non-simple requests). Given the server binds to `0.0.0.0`, a malicious webpage could make requests to `localhost:3000/api/*` for endpoints that do not require preflight. **Combined with no authentication, this is exploitable.** |

---

## 9. Rate Limiting

### Status: MINIMAL

| # | Severity | Finding |
|---|----------|---------|
| SEC-29 | MEDIUM | **No rate limiting on API endpoints.** There is no rate limiting middleware. The only concurrency control is `MAX_CONCURRENT_EXECUTIONS` (default 5) for engine processes and `MAX_SESSIONS` (10) for terminal sessions. An attacker could rapidly create issues, trigger executions, or flood the SSE endpoint. |
| SEC-30 | LOW | **MCP session limit provides some protection.** MCP is capped at 100 sessions with 30-minute TTL and oldest-eviction. |

---

## 10. Sensitive Data in Logs

### Status: PASS (mostly)

| # | Severity | Finding |
|---|----------|---------|
| SEC-31 | PASS | **Error handler does not leak stack traces.** `app.ts` global error handler returns generic `"Internal server error"` to clients and logs full details server-side only. |
| SEC-32 | LOW | **Engine I/O logging enabled by default.** `LOG_EXECUTOR_IO` defaults to `'1'` (enabled). Engine stdout/stderr may contain sensitive data (API responses, file contents, user prompts). In production deployments, this should default to off. |
| SEC-33 | PASS | **Terminal PTY output not logged.** Terminal I/O is forwarded directly via WebSocket without server-side logging. |
| SEC-34 | LOW | **Webhook delivery payloads logged.** `webhooks/dispatcher.ts` stores full payload text and response text (truncated to 1KB) in the `webhook_deliveries` table. These may contain issue content. Delivery cleanup runs periodically (keeps last 100 per webhook). |

---

## 11. Environment Variable Handling

### Status: GOOD

| # | Severity | Finding |
|---|----------|---------|
| SEC-35 | PASS | **Bun auto-loads `.env` from CWD.** No `dotenv` dependency; uses runtime-native `.env` loading. |
| SEC-36 | PASS | **Runtime endpoint gated by env var.** The `/api/runtime` debug endpoint is only accessible when `ENABLE_RUNTIME_ENDPOINT=true`. |
| SEC-37 | LOW | **`HOST` and `PORT` env vars exposed in `/api/runtime` (when enabled).** While gated, these values leak server configuration. The endpoint also exposes `Bun.version`, `process.versions`, and `process.execPath`. |

---

## 12. Additional Findings

| # | Severity | Finding |
|---|----------|---------|
| SEC-38 | PASS | **Secure headers enabled.** `hono/secure-headers` middleware is applied globally, setting `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, etc. |
| SEC-39 | PASS | **PID lock prevents concurrent instances.** `pid-lock.ts` prevents multiple server instances from writing to the same database. |
| SEC-40 | PASS | **Checksum verification is mandatory.** Both the upgrade system and the launcher refuse to install packages without successful checksum verification. |
| SEC-41 | MEDIUM | **`IS_SANDBOX` env var passed to engine processes.** `safe-env.ts` passes `IS_SANDBOX` to child engine processes. If set, this enables `--dangerously-skip-permissions` mode for Claude Code, bypassing its safety controls. This is a feature for sandboxed environments but could be dangerous if set incorrectly. |
| SEC-42 | LOW | **No Content Security Policy (CSP).** `secureHeaders()` sets basic headers but no CSP. Adding CSP would protect against inline script injection in the frontend. |

---

## Priority-Ranked Issues

| Priority | ID | Summary | Recommendation |
|----------|-----|---------|----------------|
| **CRITICAL** | SEC-24 | No authentication on main API | Implement authentication middleware. At minimum, support `API_SECRET` bearer token auth with localhost bypass (similar to MCP endpoint pattern). |
| **HIGH** | SEC-28 | No CORS + no auth = exploitable | Add `hono/cors` middleware with explicit origin allowlist. Combined with SEC-24, this creates a real attack surface. |
| **HIGH** | SEC-14 | Unauthenticated terminal shell access | Terminal creation and WebSocket attachment must require authentication. |
| **MEDIUM** | SEC-11 | `dangerouslySetInnerHTML` ESLint rule disabled | Re-enable as `warn`; use inline disable on sanitized usages. |
| **MEDIUM** | SEC-25 | MCP auth is opt-in | Good design but ensure documentation clearly states the security implications. |
| **MEDIUM** | SEC-26 | No project-level access control | Document as single-user design. Consider adding basic auth for team scenarios. |
| **MEDIUM** | SEC-29 | No rate limiting | Add rate limiting middleware at minimum on: terminal creation, issue execution, file upload. |
| **MEDIUM** | SEC-41 | `IS_SANDBOX` enables permission bypass | Document clearly. Consider requiring an additional confirmation mechanism. |
| **LOW** | SEC-05 | Webhook secrets stored as plaintext | Encrypt sensitive fields at rest. |
| **LOW** | SEC-06 | Project env vars stored as plaintext | Encrypt sensitive fields at rest. |
| **LOW** | SEC-08 | Unparameterized PRAGMA query | Not exploitable but violates principle. Add a comment explaining why. |
| **LOW** | SEC-21 | Read operations do not verify symlinks | Add symlink verification to `handleShow()` and `handleRaw()`. |
| **LOW** | SEC-22 | Webhook SSRF potential | Consider URL validation or a denylist for private IP ranges. |
| **LOW** | SEC-32 | Engine I/O logging enabled by default | Default to off in production. |
| **LOW** | SEC-34 | Webhook payloads persisted in DB | Document data retention policy. |
| **LOW** | SEC-42 | No Content Security Policy | Add CSP header via `secureHeaders()` configuration. |

---

## Positive Security Practices

The codebase demonstrates several commendable security practices:

1. **Defense in depth for path traversal:** Multiple layers of validation (logical path check, symlink resolution, basename validation).
2. **Environment allowlisting for child processes:** `safe-env.ts` prevents accidental secret leakage.
3. **Checksum verification on all downloads:** Both upgrade system and launcher enforce SHA-256 verification.
4. **DOMPurify on all innerHTML usages:** Consistent sanitization pattern.
5. **Array-based subprocess spawning:** No shell injection vectors.
6. **Drizzle ORM throughout:** Parameterized queries prevent SQL injection.
7. **Soft deletion pattern:** Data is recoverable, prevents accidental permanent loss.
8. **Global error handler suppresses stack traces:** Internal details are logged server-side only.
9. **PID lock prevents concurrent instances:** Avoids database corruption.
10. **Allowed-host validation on launcher downloads:** Only trusted GitHub domains accepted.
