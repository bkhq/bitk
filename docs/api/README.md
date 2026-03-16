# BKD API Reference

Base URL: `/api`

## Response Envelope

All responses use a standard envelope:

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
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict |
| `429` | Too Many Requests |
| `500` | Internal Server Error |

## Validation

All POST/PATCH routes use Zod schema validation via `@hono/zod-validator`. Validation errors return `400` with comma-separated error messages.

## Soft Deletion

All DELETE operations use `isDeleted` flag — data is never hard-deleted.

## Security

- Workspace root boundary validation (SEC-016)
- Git command injection prevention (SEC-019)
- Workspace directory confinement (SEC-022)
- XSS prevention via `Content-Disposition: attachment` (SEC-024)
- Symlink traversal prevention via `realpath()` (SEC-025)

## Sections

| Document | Description |
|---|---|
| [system.md](./system.md) | Health check, status, runtime |
| [projects.md](./projects.md) | Project CRUD, archive, sort |
| [issues.md](./issues.md) | Issue CRUD, bulk update |
| [execution.md](./execution.md) | Execute, follow-up, restart, cancel |
| [logs.md](./logs.md) | Issue logs (paginated) |
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
| [settings.md](./settings.md) | System settings |
