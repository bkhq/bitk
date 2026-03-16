# Terminal

## POST /api/terminal

Create a new PTY session. Max 10 concurrent sessions.

**Response:** `201` with `{ id }`

## GET /api/terminal/:id

Check if a terminal session is alive.

## GET /api/terminal/ws/:id

WebSocket connection for terminal I/O.

**Binary Protocol:**
- `[0x00][data]` — input
- `[0x01][cols:u16][rows:u16]` — resize

Grace period: 60s after disconnect before PTY kill.

## POST /api/terminal/:id/resize

Resize terminal (REST fallback).

**Request Body:** `{ cols: 1-500, rows: 1-200 }`

## DELETE /api/terminal/:id

Kill a terminal session.
