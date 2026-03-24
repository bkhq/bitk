# BKD API Reference

Base URL: `/api`

## Response Envelope

Most JSON CRUD responses use a standard envelope. Exceptions include binary/file download endpoints (which return raw streams) and `/api/runtime` (which returns a raw object).

```json
{ "success": true, "data": T }
{ "success": false, "error": "message" }
```

## Status Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `202` | Accepted (async operation started) |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict |
| `429` | Too Many Requests |
| `500` | Internal Server Error |

## Validation

All POST/PATCH routes use Zod schema validation via `@hono/zod-validator`. Validation errors return `400` with comma-separated error messages.

## Soft Deletion

Database-backed DELETE operations (projects, issues, notes, webhooks, etc.) use an `isDeleted` flag — data is never hard-deleted. However, some endpoints perform **irreversible** deletions: file DELETE (`/api/files/*`) removes files from disk, and worktree DELETE (`/api/worktrees/*`) physically removes Git worktrees.

## Security

### Headers

- **CSP**: `default-src 'self'`, inline scripts/styles allowed, frames blocked, object-src none
- **HSTS**: `max-age=31536000; includeSubDomains`
- **CORS**: Configurable via `ALLOWED_ORIGIN` env var (comma-separated origins or `*`). Methods: GET, POST, PATCH, DELETE, OPTIONS. Credentials enabled when origin is not `*`.

### Request Protection

- Workspace root boundary validation (SEC-016)
- Git command injection prevention (SEC-019)
- Workspace directory confinement (SEC-022)
- XSS prevention via `Content-Disposition: attachment` (SEC-024)
- Symlink traversal prevention via `realpath()` (SEC-025)
- SSRF protection on webhook URLs (private/internal network blocking)
- MCP API key uses timing-safe comparison

### Authentication

When `AUTH_ENABLED=true`, all `/api/*` routes (except `/api/auth/*`) require a valid Bearer JWT token. See [system.md](./system.md) for auth endpoints.

### Compression

gzip/deflate compression on all routes except SSE (`/api/events`), streaming (`*/stream`), and MCP (`/api/mcp*`).

## Sections

| Document | Description |
|---|---|
| [system.md](./system.md) | Health check, status, runtime, auth |
| [projects.md](./projects.md) | Project CRUD, archive, sort |
| [issues.md](./issues.md) | Issue CRUD, bulk update, duplicate, export, review |
| [execution.md](./execution.md) | Execute, follow-up, restart, cancel, auto-title, slash commands |
| [logs.md](./logs.md) | Issue logs (paginated, filtered) |
| [changes.md](./changes.md) | Git changes and file diffs |
| [attachments.md](./attachments.md) | File attachments |
| [engines.md](./engines.md) | Engine discovery, models, settings |
| [events.md](./events.md) | Server-Sent Events (SSE) |
| [files.md](./files.md) | File browser, read, write, delete |
| [terminal.md](./terminal.md) | PTY sessions, WebSocket |
| [processes.md](./processes.md) | Engine process management |
| [worktrees.md](./worktrees.md) | Git worktree management |
| [git.md](./git.md) | Git utilities |
| [filesystem.md](./filesystem.md) | Directory browsing and creation |
| [notes.md](./notes.md) | Notes CRUD |
| [settings.md](./settings.md) | System settings, MCP, webhooks, cleanup, upgrade |
