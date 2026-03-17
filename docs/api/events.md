# Events (SSE)

## GET /api/events

Server-Sent Events stream for real-time updates.

Single global SSE endpoint. Heartbeat every 15s. Reconnects with exponential backoff + 35s watchdog.

Compression is skipped for this route.

## Event Types

| Event | Description |
|---|---|
| `log` | New log entry from agent |
| `log-updated` | Log entry updated |
| `log-removed` | Log entry removed |
| `state` | Issue state change |
| `done` | Issue execution completed |
| `issue-updated` | Issue metadata updated |
| `changes-summary` | Git changes summary after settlement |
| `heartbeat` | Keep-alive (every 15s) |
