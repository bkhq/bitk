# AUDIT-037 Issue lock timeout releases mutual exclusion before timed-out work stops

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Concurrency
- **created**: 2026-03-19

## Location

- `apps/api/src/engines/issue/process/lock.ts:68-92`
- `apps/api/src/engines/issue/orchestration/execute.ts:33-145`

## Description

`withIssueLock()` uses `Promise.race()` to enforce a timeout, but a timeout only rejects the wrapper promise. It does not cancel the original async operation. The `finally` block still releases the lock unconditionally.

That means a second request can enter the same issue while the timed-out operation is still running in the background, breaking the lock's mutual-exclusion guarantee.

## Fix Direction

Do not release the logical issue lock until the original operation has actually stopped, or switch the implementation to an abort-aware model where the timed-out function is guaranteed to observe cancellation.
