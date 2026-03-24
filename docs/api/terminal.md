# Terminal

Terminal sessions are decoupled from WebSocket connections. A PTY survives brief WS disconnects (network blips, drawer hide/show). Sessions expire after 24 hours.

App-specific environment variables (HOST, PORT, API_SECRET, DB_PATH, etc.) are stripped from the PTY process environment.

## POST /api/terminal

Create a new PTY session. Spawns the user's default login shell (detected via `getent passwd`, `$SHELL`, or `/bin/sh`). Max 10 concurrent sessions.

**Response:** `{ id }` (returns `429` if session limit reached)

## GET /api/terminal/:id

Check if a terminal session is alive.

**Response:** `{ id }`

## GET /api/terminal/ws/:id

WebSocket connection for bidirectional terminal I/O. Returns `404` before upgrade if session does not exist.

**Binary Protocol:**
- `[0x00][data]` — input (text encoded as UTF-8)
- `[0x01][cols:u16BE][rows:u16BE]` — resize (max 500 cols, 200 rows)

Grace period: 60s after WS disconnect before PTY is killed. Previous WS is replaced if a new connection attaches to the same session.

## POST /api/terminal/:id/resize

Resize terminal (REST fallback for the WS binary resize command).

**Request Body:** `{ cols: 1-500, rows: 1-200 }`

## DELETE /api/terminal/:id

Kill a terminal session immediately.
