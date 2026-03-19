# AUDIT-056 No shutdown timeout for graceful shutdown

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-core.md
- **created**: 2026-03-19

## Location

- `apps/api/src/index.ts`

## Description

The `shutdown()` function awaits `issueEngine.cancelAll()` without a deadline. A hung engine process prevents the server from ever exiting, requiring a forced kill.

## Fix Direction

Add a timeout (e.g., 30s) around `cancelAll()`. If it doesn't complete within the deadline, force-exit with a non-zero code.
