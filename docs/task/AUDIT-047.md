# AUDIT-047 No SSE connection limit allows resource exhaustion

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/events.ts`

## Description

No limit on concurrent SSE connections. Each connection subscribes to all event types. Hundreds of connections (accidental or malicious) could exhaust memory and amplify event processing overhead, effectively DoS-ing the server.

## Fix Direction

Add a max connection count (e.g., 50). Reject new connections with 429 when limit is reached. Consider per-IP limits.
