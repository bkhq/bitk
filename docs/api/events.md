# Events (SSE)

## GET /api/events

Server-Sent Events stream for real-time updates.

Single global SSE endpoint. Heartbeat every 15s. Client-side filtering by project/issue. Reconnects with exponential backoff + 35s watchdog. On reconnect, all React Query caches are invalidated.

Compression is skipped for this route. Visibility filter is applied at the SSE boundary (internal processing sees all entries).

## Event Types

| Event | Data Fields | Description |
|---|---|---|
| `log` | `{ issueId, entry }` | New log entry from agent (non-streaming, visible only) |
| `log-updated` | `{ issueId, entry }` | Log entry content updated |
| `log-removed` | `{ issueId, ids }` | Log entries removed (e.g. pending message recall) |
| `state` | `{ issueId, executionId, state }` | Non-terminal issue state change |
| `done` | `{ issueId, finalStatus }` | Issue execution completed (terminal state) |
| `issue-updated` | `{ issueId, changes }` | Issue metadata updated (status, title, etc.) |
| `changes-summary` | `{ issueId, ... }` | Git changes summary after settlement |
| `heartbeat` | `{ ts }` | Keep-alive (every 15s) |

Terminal states (`completed`, `failed`, `cancelled`) are emitted via the `done` event after the DB is updated, not via `state`.
