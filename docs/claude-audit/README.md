# BKD Codebase Audit Report

**Date**: 2026-03-19
**Scope**: Full repository audit (~47K lines TypeScript)
**Modules**: 8 parallel audits covering backend, frontend, shared, build/CI, and security

---

## Overall Assessment

| Area | Quality | Critical | High | Medium | Low |
|------|---------|----------|------|--------|-----|
| [Backend Core](./backend-core.md) | 4.0/5 | 0 | 3 | 7 | 9 |
| [Backend Routes](./backend-routes.md) | 3.8/5 | 2 | 3 | 5 | 10 |
| [Backend Engine System](./backend-engines.md) | 4.2/5 | 0 | 3 | 5 | 8 |
| [Backend Subsystems](./backend-subsystems.md) | 3.7/5 | 6 | 5 | 8 | 6 |
| [Frontend Core](./frontend-core.md) | 3.9/5 | 2 | 3 | 5 | — |
| [Frontend Components](./frontend-components.md) | 3.8/5 | 2 | 4 | 6 | — |
| [Frontend State](./frontend-state.md) | 3.8/5 | 2 | 4 | 6 | 8 |
| [Shared & Build/CI](./shared-and-build.md) | 4.0/5 | — | — | — | — |
| [Security (Cross-cutting)](./security.md) | — | 1 | 2 | 4 | — |
| **Total** | **3.9/5** | **15** | **27** | **46** | **41** |

---

## Top Critical Issues (Must Fix)

### SEC: No Authentication Layer
- **Severity**: CRITICAL
- **Location**: Entire API (`apps/api/src/routes/`)
- **Impact**: All endpoints (file operations, terminal, issue execution) accessible without credentials
- **Details**: `API_SECRET` env var is referenced but never enforced as middleware
- **Files**: `backend-routes.md`, `security.md`

### SEC: Unauthenticated Terminal WebSocket = RCE
- **Severity**: CRITICAL
- **Location**: `routes/terminal.ts`
- **Impact**: Any network client gets full shell access
- **Files**: `backend-routes.md`, `security.md`

### SEC: SSE Event Stream Broadcasts Without Auth
- **Severity**: CRITICAL
- **Location**: `routes/events.ts`
- **Impact**: All issue data, logs, and state changes visible to any client
- **Files**: `backend-routes.md`

### SEC: Webhook Secrets as Plaintext Bearer Tokens
- **Severity**: CRITICAL
- **Location**: `webhooks/dispatcher.ts`
- **Impact**: Secrets sent in HTTP headers instead of HMAC signatures; interceptable in transit
- **Files**: `backend-subsystems.md`

### SEC: Path Traversal via `isPathWithinDir()` Prefix Check
- **Severity**: CRITICAL
- **Location**: Subsystem utility
- **Impact**: Naive string prefix check vulnerable to directory name collisions (e.g., `/workspace` vs `/workspace-evil`)
- **Files**: `backend-subsystems.md`

### SEC: MCP Server Has No Authentication
- **Severity**: CRITICAL
- **Location**: `mcp/server.ts`
- **Impact**: Unauthenticated access to project creation and management
- **Files**: `backend-subsystems.md`

### FE: Oversized Components (1618 and 991 lines)
- **Severity**: CRITICAL (maintainability)
- **Location**: `AppSettingsDialog.tsx` (1618 lines), `ChatInput.tsx` (991 lines)
- **Impact**: Unmaintainable, hard to test, risk of regressions
- **Files**: `frontend-components.md`

### FE: Dead Code - FileBrowserPage Has No Route
- **Severity**: CRITICAL
- **Location**: `pages/FileBrowserPage.tsx`
- **Impact**: Entire page component is unreachable dead code
- **Files**: `frontend-core.md`

---

## High Priority Issues

### Backend
1. **Cache thundering herd** in `cacheGetOrSet` - no dedup for concurrent requests (`backend-core.md`)
2. **SQL string interpolation** in schema verification (`backend-core.md`)
3. **Git route bypasses workspace sandbox** (`backend-routes.md`)
4. **No rate limiting** on any API endpoint (`backend-routes.md`, `security.md`)
5. **MCP API key comparison not timing-safe** (`backend-routes.md`)
6. **Lock timeout rejects without cancelling** underlying operation (`backend-engines.md`)
7. **ManagedProcess** has 30+ mutable fields with no formal state machine docs (`backend-engines.md`)
8. **Codex `sendUserMessage` error silently swallowed** (`backend-engines.md`)
9. **SSE emit-during-unsubscribe race condition** (`backend-subsystems.md`)
10. **No SSE connection limit** - resource exhaustion risk (`backend-subsystems.md`)
11. **No CORS configuration** combined with no auth (`security.md`)

### Frontend
12. **Missing `AbortSignal` propagation** in API client - race conditions (`frontend-state.md`)
13. **Terminal session resource leak** on `reset()` (`frontend-state.md`)
14. **KanbanCard lacks keyboard accessibility** (`frontend-components.md`)
15. **Code duplication** between `IssueDetailPage` and `ReviewPage` (~80%) (`frontend-core.md`)
16. **Unbounded dedup sets** in `use-issue-stream` (`frontend-state.md`)
17. **No `prefers-reduced-motion`** CSS support (`frontend-core.md`)

---

## Positive Findings

The codebase demonstrates strong engineering fundamentals:

- **Database**: All queries use Drizzle ORM (parameterized) - no SQL injection vectors
- **Subprocess**: All spawning uses array-based arguments - no command injection
- **XSS**: All `dangerouslySetInnerHTML` usages sanitized with DOMPurify
- **Path safety**: Comprehensive traversal prevention with symlink verification on writes
- **Upgrade security**: SHA-256 checksum verification mandatory on all downloads
- **Environment safety**: Allowlist-based env filtering prevents secret leakage to child processes
- **No hardcoded secrets**: `.env` files properly gitignored
- **Engine system**: Excellent defensive programming (TOCTOU mitigations, cancel escalation, three-tier stall detection)
- **i18n**: Perfect coverage (491 keys, 1:1 parity between en/zh)
- **Architecture**: Clean separation of server state (React Query) vs UI state (Zustand)
- **Type safety**: Shared types package ensures API contract consistency

---

## Recommended Fix Order

1. **Add authentication middleware** (blocks all SEC-Critical issues)
2. **Fix `isPathWithinDir()` to use proper path resolution** (path traversal)
3. **Switch webhook secrets to HMAC signing** (secret exposure)
4. **Add CORS configuration** (browser-based attacks)
5. **Add rate limiting** (DoS protection)
6. **Split oversized components** (maintainability)
7. **Add `AbortSignal` to API client** (race conditions)
8. **Fix cache thundering herd** (performance under load)
9. **Add SSE connection limits** (resource exhaustion)
10. **Clean up dead code** (FileBrowserPage, duplicated logic)

---

## Report Files

| File | Description |
|------|-------------|
| [backend-core.md](./backend-core.md) | App setup, config, cache, logger, DB, utilities |
| [backend-routes.md](./backend-routes.md) | All API route handlers (35 files) |
| [backend-engines.md](./backend-engines.md) | Engine system, executors, process management (60+ files) |
| [backend-subsystems.md](./backend-subsystems.md) | Upgrade, jobs, events/SSE, webhooks, MCP |
| [frontend-core.md](./frontend-core.md) | Pages, routing, i18n, entry point |
| [frontend-components.md](./frontend-components.md) | All UI components (45+ files) |
| [frontend-state.md](./frontend-state.md) | Stores, hooks, event bus, API client, utilities |
| [shared-and-build.md](./shared-and-build.md) | Shared types, build scripts, CI/CD |
| [security.md](./security.md) | Cross-cutting security review |
