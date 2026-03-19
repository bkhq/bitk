# API Runtime Shell Audit

## Boundary

This module covers:

- `apps/api/src/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/api.ts`
- `apps/api/src/routes/events.ts`
- `apps/api/src/routes/terminal.ts`
- startup jobs, PID lock handling, static serving, and runtime info endpoints

## Entry Points

- `apps/api/src/index.ts` boots the server, PID lock, reconciliation, webhook dispatcher, upload/worktree cleanup, and upgrade checks.
- `apps/api/src/app.ts` mounts all public API surfaces and applies only security headers, compression, logging, and a generic error handler.
- `apps/api/src/routes/terminal.ts` exposes a persistent PTY lifecycle under `/api/terminal`.

## Confirmed Runtime Risks

### `AUDIT-034` Critical: privileged routes have no in-app auth layer

Evidence:

- `apps/api/src/app.ts:23-29` mounts `/api`, `/api/settings`, `/api/notes`, `/api/mcp`, and `/api/terminal`
- `apps/api/src/routes/terminal.ts:146-195` creates PTY sessions
- `apps/api/src/routes/settings/upgrade.ts:131-149` can restart the server

Impact:

- The backend assumes an upstream reverse proxy or deployment boundary will enforce auth.
- If that assumption is wrong or weak, high-impact local-system capabilities are reachable directly.

### Terminal route is the sharpest consequence of the same boundary

Evidence:

- `apps/api/src/routes/terminal.ts:146-179` spawns a login shell
- `apps/api/src/routes/terminal.ts:242-269` writes websocket input directly into the PTY

Impact:

- If the main API is ever exposed without the intended proxy gate, `/api/terminal` is effectively a host-shell endpoint.

## Existing Backlog Mapped Here

- `AUDIT-016`: SSE subscription leak after partial creation
- `AUDIT-036`: SSE broadcasts cross-project activity globally
- `AUDIT-018`: SPA fallback path is unreachable
- `AUDIT-023`: cache sweep timer is not cleaned up on shutdown
- `AUDIT-026`: SSE serialization failures have no logging
- `AUDIT-027`: global rate limiting is missing

## Notes

- `apps/api/src/routes/api.ts:131-149` already gates `/api/runtime` behind `ENABLE_RUNTIME_ENDPOINT`, which is a good containment step for runtime metadata.
- Terminal session limits and expiry exist, but they are operational controls, not authorization controls.

## Recommended Follow-Up

1. Treat route exposure and auth assumptions as application requirements, not just deployment guidance.
2. Fix `AUDIT-036` together with other SSE lifecycle bugs so the stream is both scoped and robust.
3. Review whether terminal and upgrade routes should be separately gated even behind a trusted reverse proxy.
