# AUDIT-036 Global SSE stream broadcasts cross-project activity to any subscriber

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/events.ts:11-89`

## Description

The SSE endpoint broadcasts issue updates, execution state, completion events, and change summaries globally and relies on client-side filtering by project or issue. The server does not scope subscriptions per project or per user.

This allows any subscriber who can reach `/api/events` to observe cross-project activity metadata and, depending on event content, potentially sensitive prompts, paths, or tool output context.

## Fix Direction

Bind SSE subscriptions to authenticated principals and filter events server-side by project or explicit subscription scope before writing them to the stream.
