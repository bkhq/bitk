# Security Audit Report

**Date:** 2026-03-23
**Scope:** Full monorepo — `apps/api/`, `apps/frontend/`, `packages/shared/`
**Auditor:** Automated static analysis
**Overall Risk Rating:** **High** — One high-severity environment variable override allows users to hijack engine API keys and PATH. Multiple high-severity issues around authentication being opt-in, unrestricted terminal access, and missing CSP. No unauthenticated remote code execution when auth is enabled.

---

## Executive Summary

The codebase demonstrates solid security awareness with many best practices already in place:
- Zod schema validation on all POST/PATCH routes
- DOMPurify sanitization for all `dangerouslySetInnerHTML` usage
- Path traversal protection with `isInsideRoot()` and symlink verification
- Environment variable allowlisting via `safeEnv()` for child processes
- SSRF protection on webhook URLs via `isPrivateHost()` blocking
- Proper use of Drizzle ORM parameterized queries (no raw SQL injection vectors)
- Hono `secureHeaders()` middleware enabled globally
- Auth middleware with JWT verification and OIDC integration

However, several areas require attention, primarily around: environment variable override in engine spawning, authentication being opt-in, custom JWT implementation, terminal WebSocket access controls, file system route scope, missing CSP, and SSE data leakage potential.

---

## Findings

### 1. Authentication & Authorization

#### SEC-001: Authentication is disabled by default — **High**

**Location:** `apps/api/src/auth/config.ts:22-37`, `apps/api/src/auth/middleware.ts:29-31`

**Description:** Authentication is gated behind `AUTH_ENABLED=true` environment variable. When disabled (default), **all API endpoints are fully public** including:
- Terminal WebSocket (`/api/terminal/ws/*`) — arbitrary command execution
- File system routes (`/api/files/*`) — read/write/delete any file
- Engine execution (`/api/projects/*/issues/*/execute`) — spawn AI agent processes
- Settings & upgrade routes — server configuration and binary replacement

**Impact:** Anyone with network access to the server can execute arbitrary commands, read/write files, and control AI engine processes.

**Remediation:**
- Consider enabling authentication by default
- At minimum, bind to `127.0.0.1` by default when auth is disabled
- Add prominent documentation warning about running without auth on a network

---

#### SEC-002: No CORS configuration — **Medium**

**Location:** `apps/api/src/app.ts`

**Description:** No CORS middleware is configured. While the Vite dev proxy handles `/api/*` forwarding, in production the API and frontend are served from the same origin. However, absence of explicit CORS means any origin can make requests when auth is disabled.

**Impact:** Cross-origin requests from malicious sites could interact with the API if the user has the application open.

**Remediation:** Add explicit CORS middleware restricting to the application's own origin, or `ALLOWED_ORIGIN` from env.

---

#### SEC-003: SSE endpoint broadcasts all events globally — **Medium**

**Location:** `apps/api/src/routes/events.ts:12-13`

**Description:** The SSE endpoint at `GET /api/events` broadcasts **all** issue events from **all** projects. There is no project-scoped filtering. Any authenticated (or unauthenticated when auth is off) client receives logs, state changes, and file change summaries for every project.

**Impact:** Information disclosure across project boundaries. If multiple users share a server, one user sees all other users' AI agent activities.

**Remediation:** Add project-scoped SSE endpoints or server-side filtering based on user permissions.

---

#### SEC-024: Custom JWT implementation with no token revocation — **High**

**Location:** `apps/api/src/auth/jwt.ts:19-63`, `apps/api/src/auth/routes.ts`

**Description:** The JWT is hand-rolled using `createHmac` + base64url. While it correctly uses `timingSafeEqual` for signature verification and checks expiry, there are structural weaknesses:
1. **No token revocation:** There is no JTI-based blacklist or session store. A leaked token remains valid until expiry. The `POST /api/auth/logout` route is a no-op — it cannot actually invalidate the token.
2. **Ephemeral signing key:** When `AUTH_SECRET` is not set, a random key is generated at startup, silently destroying all sessions on restart.

**Impact:** Stolen JWT tokens cannot be revoked. Logout is ceremonial only.

**Remediation:** Use a well-tested JWT library (e.g., `jose`). Add a short-lived token revocation list for logout. Consider using `httpOnly` cookies instead of Bearer tokens.

---

#### SEC-025: JWT token accepted in URL query parameter — **Medium**

**Location:** `apps/api/src/auth/middleware.ts:42-45`

**Description:** The auth middleware falls back to extracting the JWT from `?token=` in the URL. This is needed for EventSource (SSE) and WebSocket, which cannot set custom headers. However, this causes the JWT to appear in server access logs, browser history, proxy logs, and `Referer` headers.

**Impact:** Token leakage through logs and browser history.

**Remediation:** Use a short-lived one-time ticket system for SSE/WebSocket auth, or `httpOnly` cookies.

---

#### SEC-026: No rate limiting on auth token exchange — **Medium**

**Location:** `apps/api/src/auth/routes.ts`

**Description:** `POST /api/auth/token` (OAuth code exchange) has no rate limiting. An attacker who can guess or brute-force authorization codes has unlimited attempts.

**Remediation:** Add rate limiting on auth endpoints.

---

#### SEC-027: MCP API key comparison is not timing-safe — **Low**

**Location:** `apps/api/src/routes/mcp.ts:128`

**Description:** `token !== apiKey` uses direct string equality. While timing side-channels require many samples and the impact is minimal for long random keys, best practice mandates `timingSafeEqual`.

**Remediation:** Replace with `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))`.

---

### 2. Process Execution Security

#### SEC-004: Terminal endpoint provides unrestricted shell access — **High**

**Location:** `apps/api/src/routes/terminal.ts:147-194`

**Description:** `POST /terminal` spawns a login shell (`bash -l` or user's default shell) with no restrictions beyond auth middleware. When auth is disabled, this is an unauthenticated remote shell. Even with auth enabled, there are no per-user session limits or audit logging of commands.

**Impact:** Full system command execution for any API client.

**Remediation:**
- Ensure terminal routes require authentication regardless of global setting
- Add command audit logging
- Consider restricting to workspace root via chroot or namespace

---

#### SEC-005: Engine processes run with full system access — **Medium**

**Location:** `apps/api/src/engines/executors/codex/executor.ts:304-306`

**Description:** Codex executor spawns with `approvalPolicy: 'never'` and `sandbox: 'danger-full-access'`, granting the AI agent unrestricted system access.

**Impact:** AI agents can perform any system operation without sandbox restrictions. While this is somewhat by design for a local development tool, it means a malicious prompt could instruct the agent to exfiltrate data or modify system files.

**Remediation:**
- Document the security model clearly
- Consider adding configurable sandbox levels per project

---

#### SEC-006: Project envVars can override protected engine environment variables — **High**

**Location:** `apps/api/src/engines/safe-env.ts:40-49`, `apps/api/src/routes/issues/_shared.ts:295-301`

**Description:** Users can set arbitrary key-value `envVars` on a project (schema: `z.record(z.string(), z.string())`). These are passed to `safeEnv()` via the `extra` argument. The `extra` parameter is merged **after** the allowlisted vars using `Object.assign(env, extra)` (line 48), meaning user-supplied env vars can **override** any of the allowlisted keys — including `PATH`, `HOME`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc.

**Impact:** A user who can create/edit projects can:
- Set `PATH` to execute a malicious binary instead of the real engine
- Set `ANTHROPIC_API_KEY` to their own key, redirecting API traffic
- Override `HOME` to change credential file resolution
- Set `IS_SANDBOX=0` to change engine security behavior

**Remediation:** After calling `safeEnv()`, filter user-provided `extra` against a denylist of protected keys. Or: apply `extra` first, then overlay the allowlisted system values so they cannot be overridden.

---

#### SEC-006b: All API keys passed to all engine types — **Low**

**Location:** `apps/api/src/engines/safe-env.ts:16-19`

**Description:** The `safeEnv()` allowlist passes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `GOOGLE_API_KEY`, and `GEMINI_API_KEY` to all child engine processes regardless of engine type.

**Impact:** A compromised engine could exfiltrate API keys for other services.

**Remediation:** Pass only the relevant API key for each engine type.

---

#### SEC-028: No resource limits on spawned engine processes — **Medium**

**Location:** `apps/api/src/engines/spawn.ts` (`spawnNode` function)

**Description:** Engines are spawned with `child_process.spawn()` with no `ulimit`-style constraints, cgroup limits, or memory caps. A runaway AI agent or malicious prompt causing excessive forking can exhaust server resources. `ProcessManager.maxConcurrent` limits concurrent issues but not per-process resource consumption.

**Remediation:** Run engine processes under resource-limited cgroups or `ulimit` wrappers.

---

#### SEC-029: NPX fallback auto-installs packages from registry — **Low**

**Location:** `apps/api/src/engines/executors/claude/executor.ts:24`, `apps/api/src/engines/executors/codex/executor.ts:23`

**Description:** When the `claude` or `codex` binary is not found, executors fall back to `npx -y @anthropic-ai/claude-code` or `npx -y @openai/codex`. The `-y` flag auto-installs without confirmation. A supply chain attack on the npm registry would execute arbitrary code.

**Remediation:** Pin exact package versions. Consider disabling npx fallback in production.

---

### 3. File System Security

#### SEC-007: `/api/files/show` root parameter accepts any path — **Medium**

**Location:** `apps/api/src/routes/files.ts:55-73`

**Description:** The `resolveRootPath()` function accepts a `root` query parameter from the client. While it validates that the target path stays within the specified root, the root itself can be **any directory on the system** (e.g., `?root=/etc`). There is no workspace restriction on the `root` parameter.

**Impact:** When auth is disabled, any file on the system can be read. When auth is enabled, any authenticated user can read any file.

**Remediation:** Validate that the `root` parameter falls within the configured workspace, similar to how `filesystem.ts` does it.

---

#### SEC-008: `/api/files/raw` serves files without symlink verification — **Medium**

**Location:** `apps/api/src/routes/files.ts:216-245`

**Description:** The `handleRaw()` function checks `isInsideRoot()` but does not call `verifyRealPath()` (symlink resolution) before serving the file. Compare with `handleDelete()` (line 260) and `handleSave()` (line 289) which do verify real paths.

**Impact:** An attacker could create a symlink within the allowed root pointing to a sensitive file (e.g., `/etc/shadow`) and then request it via the raw endpoint.

**Remediation:** Add `verifyRealPath()` check to `handleRaw()` and `handleShow()` as well.

---

#### SEC-009: `/api/files/show` serves files without symlink verification — **Medium**

**Location:** `apps/api/src/routes/files.ts:113-212`

**Description:** Same issue as SEC-008. `handleShow()` reads file contents and directory listings without verifying the real path after symlink resolution.

**Remediation:** Add `verifyRealPath()` check to `handleShow()`.

---

#### SEC-010: Upload file type not validated — **Low**

**Location:** `apps/api/src/uploads.ts:41-53`

**Description:** `validateFiles()` only checks file count and size. No validation of file type or extension. Uploaded files are stored with their original extension.

**Impact:** Users could upload executable files, HTML files with JavaScript, or other potentially dangerous content. However, the attachment serving route (SEC-012) forces download via Content-Disposition.

**Remediation:** Consider adding a MIME type allowlist for uploads.

---

### 4. Input Validation & Injection

#### SEC-032: SQL string interpolation in PRAGMA table_info — **Low**

**Location:** `apps/api/src/db/index.ts:97`

**Description:** The schema verification function uses raw string interpolation for a PRAGMA query:
```ts
rows = sqlite.query(`PRAGMA table_info('${table}')`).all()
```
The `table` variable comes from Drizzle schema metadata (not user input), so this is not directly exploitable. However, it normalizes an unsafe SQL pattern in the codebase.

**Impact:** Low — source is internal schema, not user input. But the anti-pattern should be eliminated.

**Remediation:** Use a parameterized approach or validate table names against a strict allowlist.

---

#### SEC-033: Git `show HEAD:<path>` with path interpolation — **Low**

**Location:** `apps/api/src/routes/issues/changes.ts:248`

**Description:** The changes route constructs `git show HEAD:${oldPath}` where `oldPath` is user-controlled (via query parameter). The code validates against leading `-` and `:` characters (lines 179-184) and checks `isPathInsideRoot()`, but the path is interpolated into a git argument. Characters meaningful to git's pathspec syntax could cause unintended behavior. Since `spawn()` is used (not shell), this is limited to git-level interpretation only.

**Impact:** Low — array-form spawn prevents shell injection; validation blocks most vectors.

---

#### SEC-011: No SQL injection vectors in application queries — **Informational**

**Location:** `apps/api/src/db/`

**Description:** All application-level database queries use Drizzle ORM with parameterized queries. The uses of `sql` template literals (`db/schema.ts:73`, `db/helpers.ts:27,122`) use Drizzle's parameter binding. The only raw interpolation is in the schema verification PRAGMA (SEC-032), which uses internal-only values.

---

#### SEC-012: XSS — all dangerouslySetInnerHTML properly sanitized — **Informational**

**Location:** Multiple frontend files

**Description:** All 4 instances of `dangerouslySetInnerHTML` in the frontend use `DOMPurify.sanitize(html)`:
- `MarkdownContent.tsx:136`
- `CodeRenderers.tsx:120`
- `ShikiCodeBlock.tsx:35`
- `FileViewer.tsx:260`

No XSS vectors found through this pattern.

---

#### SEC-013: Command injection risk in git routes — **Low**

**Location:** `apps/api/src/routes/git.ts:12-14`, `apps/api/src/routes/files.ts:31-52`

**Description:** The `runGit()` function passes the `directory` parameter (user-controlled) as `cwd` to `runCommand()`. The `runCommand()` function uses `child_process.spawn()` (not `exec`), which prevents shell injection. Arguments are passed as arrays, not string concatenation. Similarly, `getGitIgnoredNames()` passes file names as arguments to `git check-ignore`.

**Impact:** Low. While `spawn()` prevents shell metacharacter injection, a malicious directory path could potentially cause unexpected behavior.

**Remediation:** Current implementation is safe. No action needed.

---

#### SEC-014: Webhook SSRF protection has good coverage — **Informational**

**Location:** `apps/api/src/routes/settings/webhooks.ts:13-29`

**Description:** The `isPrivateHost()` function blocks private RFC1918 ranges, loopback, link-local, cloud metadata (169.254.169.254), and IPv6 private addresses. Good coverage against SSRF.

**Note:** DNS rebinding attacks and alternative IP notation (e.g., `0x7f000001`, `::ffff:127.0.0.1`) could bypass this check. Consider resolving hostnames to IPs before checking and using CIDR-based validation.

---

#### SEC-030: `/api/git/detect-remote` accepts unrestricted directory paths — **Medium**

**Location:** `apps/api/src/routes/git.ts:32-50`

**Description:** The endpoint resolves user-supplied `directory` with `resolve()` and runs `git rev-parse` then `git remote get-url` in that directory. There is no workspace root restriction. A user can probe any directory to discover if it's a git repo and extract its remote URL, which may contain embedded credentials (`https://user:token@github.com/...`).

**Remediation:** Validate that the resolved directory is within the workspace root.

---

### 5. Secrets & Credentials

#### SEC-015: .env properly gitignored — **Informational**

**Location:** `.gitignore:33-38`

**Description:** All `.env` variants are properly included in `.gitignore`. No hardcoded API keys or secrets found in source code.

---

#### SEC-016: AUTH_SECRET auto-generates ephemeral key — **Low**

**Location:** `apps/api/src/auth/config.ts:65-68`

**Description:** When `AUTH_SECRET` is not set, a random key is generated at startup. This means all JWT sessions are invalidated on server restart, which is logged as a warning.

**Impact:** Low. Causes session invalidation on restart but no security vulnerability.

---

#### SEC-017: Webhook secrets stored in plaintext in DB — **Low**

**Location:** `apps/api/src/routes/settings/webhooks.ts:148-153`, `apps/api/src/db/schema.ts`

**Description:** Webhook signing secrets and Telegram bot tokens are stored as plaintext in the SQLite database. They are masked in API responses (`SECRET_MASK`).

**Impact:** Anyone with file system access to the SQLite database can read webhook secrets.

**Remediation:** Consider encrypting secrets at rest using a derived key from `AUTH_SECRET`.

---

### 6. HTTP Security

#### SEC-018: Security headers applied globally — **Informational**

**Location:** `apps/api/src/app.ts:16`

**Description:** `secureHeaders()` from Hono is applied globally. This sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0` (correct — modern CSP preferred)
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security` (if HTTPS)

---

#### SEC-019: No Content-Security-Policy header — **Medium**

**Location:** `apps/api/src/app.ts`

**Description:** Hono's `secureHeaders()` does not set a CSP header by default. No custom CSP is configured. The application serves a React SPA and displays AI-generated content (including tool output and file content). Without CSP, any XSS vector has maximum impact: full script execution with access to localStorage where JWT tokens may be stored.

**Impact:** Without CSP, XSS payloads are unrestricted. Combined with JWT in localStorage, a single XSS enables full account takeover.

**Remediation:** Configure `secureHeaders({ contentSecurityPolicy: { ... } })` with a strict policy: `default-src 'self'`, restrict `script-src`. At minimum deploy a report-only CSP immediately.

---

#### SEC-031: HSTS not explicitly configured — **Low**

**Location:** `apps/api/src/app.ts:16`

**Description:** Hono's default `secureHeaders()` does not set `Strict-Transport-Security` by default. If the server is exposed over HTTPS, downgrade attacks remain possible without HSTS.

**Remediation:** Configure `strictTransportSecurity: 'max-age=31536000; includeSubDomains'` when running behind TLS.

---

#### SEC-020: Error handler may leak stack traces in logs — **Low**

**Location:** `apps/api/src/app.ts:51-78`

**Description:** The global error handler logs full stack traces (`err.stack`). The response to the client correctly returns generic messages ("Internal server error"), so no information leaks to the client. This is only a concern if log files are exposed.

---

### 7. Dependency Security

#### SEC-021: 9 known CVEs in transitive dependencies — **Medium**

**Source:** `bun audit` results

| Package | Severity | Advisory | Impact |
|---------|----------|----------|--------|
| `undici >=7.0.0 <7.24.0` (via jsdom) | HIGH | GHSA-f269-vfmq-vjvj | WebSocket 64-bit length overflow |
| `undici` (same) | HIGH | GHSA-vrm6-8vpv-qv8q | Unbounded memory in WS deflate |
| `undici` (same) | HIGH | GHSA-v9p9-hfj2-hcw8 | Unhandled exception in WS |
| `flatted <=3.4.1` (via eslint) | HIGH | GHSA-rf6f-7fwh-wjgh | Prototype Pollution via parse() |
| `hono <4.12.7` (direct in @bkd/api) | MODERATE | GHSA-v8w9-8mx6-g223 | Prototype Pollution in parseBody({dot:true}) |
| `esbuild <=0.24.2` (via drizzle-kit/vite) | MODERATE | GHSA-67mh-4wv8-2f99 | Dev server cross-origin read |
| `undici` (3 moderate CVEs) | MODERATE | Various | Request smuggling, CRLF injection, DoS |

**Impact assessment:**
- The 3 HIGH `undici` CVEs affect the test environment (`jsdom`), not production. Lower risk in prod.
- The `flatted` HIGH CVE is in the ESLint dev toolchain only.
- The **`hono` MODERATE CVE is production-relevant** — `parseBody({dot:true})` enables prototype pollution. Grep confirms `parseBody` is not explicitly used in the codebase, but upgrading is strongly recommended.
- The `esbuild` CVE only affects dev server.

**Remediation:** Upgrade `hono` to `>=4.12.7` immediately. Run `bun update` for all transitive dependencies.

---

#### SEC-035: `@types/bun` pinned to `"latest"` — **Low**

**Location:** `apps/api/package.json`

**Description:** `@types/bun` uses `"latest"` as its version range instead of a pinned semver. A malicious or breaking type update would be automatically applied on the next `bun install`. This is a devDependency, so risk is limited to build-time, but it violates reproducibility.

**Remediation:** Pin to a specific version, e.g., `"@types/bun": "^1.3.11"`.

---

#### SEC-034: OIDC redirectUri not validated against server origin — **Medium**

**Location:** `apps/api/src/auth/routes.ts`, `apps/api/src/auth/oidc.ts`

**Description:** The `redirectUri` in the OIDC token exchange (`POST /api/auth/token`) is validated only as a URL format (`z.string().url()`) but is not checked against an allowlist of expected origins. It is forwarded directly to the OIDC provider's `token_endpoint`. While the OIDC provider is the ultimate authority on whether the redirect_uri matches, accepting an arbitrary URI from the client weakens defense-in-depth.

**Impact:** An attacker who intercepts an authorization code could attempt to exchange it with a different redirect_uri.

**Remediation:** Add a server-side check that `redirectUri` starts with the configured `SERVER_URL` or matches the expected callback pattern.

---

### 8. Upgrade System Security

#### SEC-022: Upgrade binary path validated — **Informational**

**Location:** `apps/api/src/upgrade/apply.ts:153`

**Description:** The upgrade system validates that the binary path is within the updates directory using `isPathWithinDir()`. SHA-256 checksum verification is mandatory for auto-downloads. Good security posture.

---

#### SEC-023: Self-upgrade spawns new process with full env — **Low**

**Location:** `apps/api/src/upgrade/apply.ts:138-139`

**Description:** In package mode, the new process is spawned with `{ ...process.env }`, which includes all environment variables (including secrets). This is necessary for the new process to function but worth noting.

---

## Summary Table

| ID | Severity | Category | Finding |
|--------|----------|------------------------|-------------------------------------------|
| SEC-006 | **High** | Process Execution | Project envVars override protected engine env (PATH, API keys) |
| SEC-001 | **High** | Auth | Authentication disabled by default |
| SEC-004 | **High** | Process Execution | Unrestricted terminal shell access |
| SEC-024 | **High** | Auth | Custom JWT with no token revocation; logout is no-op |
| SEC-002 | Medium | Auth | No CORS configuration |
| SEC-003 | Medium | Auth | SSE broadcasts all events globally |
| SEC-025 | Medium | Auth | JWT token accepted in URL query parameter (log leakage) |
| SEC-026 | Medium | Auth | No rate limiting on auth token exchange |
| SEC-005 | Medium | Process Execution | Engine processes run with full system access |
| SEC-028 | Medium | Process Execution | No resource limits on spawned engine processes |
| SEC-007 | Medium | File System | File browse root accepts any filesystem path |
| SEC-008 | Medium | File System | Raw file serve lacks symlink verification |
| SEC-009 | Medium | File System | File show lacks symlink verification |
| SEC-030 | Medium | File System | Git detect-remote accepts unrestricted directory |
| SEC-019 | Medium | HTTP | No Content-Security-Policy header |
| SEC-021 | Medium | Dependencies | 9 CVEs in dependencies (hono, undici, flatted, esbuild) |
| SEC-034 | Medium | Auth | OIDC redirectUri not validated against server origin |
| SEC-006b | Low | Process Execution | All API keys passed to all engine types |
| SEC-029 | Low | Process Execution | NPX fallback auto-installs from registry |
| SEC-010 | Low | File System | Upload file type not validated |
| SEC-032 | Low | Injection | SQL string interpolation in PRAGMA (internal source) |
| SEC-033 | Low | Injection | Git show HEAD:path interpolation |
| SEC-013 | Low | Injection | Git route cwd from user input (safe via spawn) |
| SEC-016 | Low | Secrets | Ephemeral auth secret on restart |
| SEC-017 | Low | Secrets | Webhook secrets in plaintext DB |
| SEC-020 | Low | HTTP | Stack traces in server logs |
| SEC-023 | Low | Upgrade | Full env passed to upgrade spawn |
| SEC-027 | Low | Auth | MCP API key comparison not timing-safe |
| SEC-031 | Low | HTTP | HSTS not explicitly configured |
| SEC-035 | Low | Dependencies | @types/bun pinned to "latest" (supply chain risk) |
| SEC-011 | Info | Injection | No SQL injection vectors |
| SEC-012 | Info | XSS | All innerHTML properly sanitized (DOMPurify) |
| SEC-014 | Info | SSRF | Good webhook SSRF protection (with DNS rebinding caveat) |
| SEC-015 | Info | Secrets | .env properly gitignored |
| SEC-018 | Info | HTTP | Security headers applied globally |
| SEC-022 | Info | Upgrade | Binary path properly validated |

## Risk Summary

- **Critical:** 0
- **High:** 4
- **Medium:** 13
- **Low:** 12
- **Informational:** 5

**Total findings: 34**

## Recommendations (Priority Order)

1. **Fix envVars override** (SEC-006) — filter user-provided env vars against protected keys in `safeEnv()` before merging
2. **Bind to localhost by default** when `AUTH_ENABLED` is not set, or enable auth by default
3. **Add CSP headers** — configure `Content-Security-Policy` in `secureHeaders()`
4. **Add symlink verification** to `handleRaw()` and `handleShow()` in `files.ts`
5. **Restrict file browse root** to workspace directory in `/api/files/*` routes
6. **Add CORS middleware** with explicit origin allowlist
7. **Implement token revocation** — add session store or JTI blacklist for logout
8. **Add rate limiting** on auth endpoints
9. **Restrict git detect-remote** to workspace root
10. **Scope SSE events** to project/user permissions
11. **Consider `httpOnly` cookies** for session management instead of Bearer tokens in localStorage
