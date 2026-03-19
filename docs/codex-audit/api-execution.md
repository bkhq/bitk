# API Execution Engine Audit

## Boundary

This module covers:

- `apps/api/src/routes/issues/*`
- `apps/api/src/engines/issue/*`
- `apps/api/src/engines/executors/*`
- `apps/api/src/engines/reconciler.ts`
- `apps/api/src/events/*`
- `packages/shared/src/index.ts` where execution-facing payloads are shared with the frontend

## Entry Points

- `apps/api/src/routes/issues/command.ts` turns issue execution requests into background engine work.
- `apps/api/src/routes/issues/message.ts` and shared helpers coordinate follow-up flows, pending-message relocation, and session reuse.
- `apps/api/src/engines/issue/engine.ts` is the execution orchestrator that fans into process management, persistence, streams, and reconciliation.

## Current Risk Profile

This is the highest-complexity area in the repository. Most correctness risk comes from:

- concurrent process lifecycle updates
- replaying logs to the frontend while also trimming or rebuilding them
- reconciling issue state after process crashes, follow-ups, or restart paths
- translating multiple executor protocols into one shared timeline model

## Existing Backlog Mapped Here

### Critical

- `AUDIT-002`: notes route misses project scoping and permission checks
- `AUDIT-004`: asynchronous turn settlement race

### High

- `AUDIT-005`: engine-domain memory leak
- `AUDIT-006`: reconciler scan scope is too narrow
- `AUDIT-007`: reconciler and spawn race
- `AUDIT-008`: logs endpoint `limit` bypasses Zod validation
- `AUDIT-009`: child-process `exited` promise has no timeout
- `AUDIT-037`: issue lock timeout releases the lock before timed-out work actually stops

### Medium

- `AUDIT-010`: lock timeout computes `lockDepth` incorrectly
- `AUDIT-011`: stderr reader lock is not released
- `AUDIT-012`: `finishedAt` timestamp race
- `AUDIT-013`: `parentId` query parameter is unvalidated
- `AUDIT-019`: execute/follow-up model validation diverges

### Low

- `AUDIT-020`: issues list has no pagination limit
- `AUDIT-022`: `sessionStatus` lacks DB `CHECK` and index
- `AUDIT-025`: upload paths leak into AI engine context

## Audit Notes

- `apps/api/src/routes/issues/_shared.ts:61-84` and `apps/api/src/routes/issues/_shared.ts:74-84` define separate request schemas for execute and follow-up, which is exactly where validation drift such as `AUDIT-019` tends to start.
- `apps/api/src/routes/issues/command.ts:103-126` and `apps/api/src/routes/issues/_shared.ts:242-320` show two execution triggers: direct HTTP execution and fire-and-forget auto-execution. They need to keep the same state and workspace guarantees.
- `apps/api/src/engines/issue/process/lock.ts` is a correctness choke point. If its timeout path is not truly abort-aware, the entire issue state machine stops being mutually exclusive.
- `packages/shared/src/index.ts` is part of this module because UI-visible execution correctness depends on the shape of `NormalizedLogEntry`, `ToolAction`, and `ChatMessage`.

## Recommended Follow-Up

1. Resolve the P0/P1 execution-state races before adding new executor features.
2. Unify request validation and model normalization so execute/follow-up cannot drift again.
3. Add stronger invariants around session status, timestamps, and log persistence ordering.
