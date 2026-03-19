# Frontend App Shell Audit

## Boundary

This module covers:

- `apps/frontend/src/main.tsx`
- `apps/frontend/src/pages/*`
- `apps/frontend/src/hooks/use-kanban.ts`
- `apps/frontend/src/hooks/use-issue-stream.ts`
- `apps/frontend/src/lib/event-bus.ts`
- global Zustand stores used by routing and application shell behavior

## Newly Confirmed Findings

### `AUDIT-032` Low: `FileBrowserPage` is unreachable

Evidence:

- `apps/frontend/src/pages/FileBrowserPage.tsx:14-189`
- `apps/frontend/src/main.tsx:167-225`

Why it matters:

- The page implements its own `/projects/:projectId/files/*` navigation model.
- The router never mounts such a route.
- This leaves dead page code and raises the chance that page-level logic drifts from the supported drawer-based file browser.

### `AUDIT-039` Medium: long-running issue streams can lose later updates

Evidence:

- `apps/frontend/src/hooks/use-issue-stream.ts:130-180`
- `apps/frontend/src/hooks/use-issue-stream.ts:186-217`
- `apps/frontend/src/lib/event-bus.ts:66-76`

Why it matters:

- the hook trims old live-log entries after 500 messages
- trimmed IDs remain in the dedup set
- a later `log-updated` event for a trimmed entry can be rejected as "already seen"

Impact:

- long sessions can display stale or incomplete assistant/tool state
- pending/done transitions can drift from the server view for trimmed entries

## Observations

### Global SSE side effects live outside React lifecycle

Evidence:

- `apps/frontend/src/main.tsx:27-51`

Impact:

- `eventBus.connect()` and the global invalidation listeners are installed at module scope, not in a React lifecycle boundary.
- In production this mostly behaves like a singleton bootstrap, but in development and HMR scenarios it is easier to accumulate duplicate listeners or stale timers.

Assessment:

- This is a correctness and operability concern, not a tracked defect yet.

### `projectId` route params often carry project alias semantics by design

Evidence:

- `apps/frontend/src/pages/ReviewPage.tsx:30-32`
- `apps/api/src/db/helpers.ts:15-40`

Assessment:

- This looks confusing at first glance, but backend `findProject()` explicitly supports lookup by either ID or alias.
- It is therefore a naming ambiguity, not a confirmed bug in this pass.

## Recommended Follow-Up

1. Fix `AUDIT-039` before relying on long-lived chat or timeline sessions for review-heavy work.
2. Either wire `FileBrowserPage` into the router or delete it.
3. Consider moving global EventSource bootstrap into an app-level component with explicit cleanup semantics.
4. Rename route variables or add comments where alias-vs-ID semantics are intentional.
