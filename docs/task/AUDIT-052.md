# AUDIT-052 Upgrade apply process.exit prevents finally block cleanup

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/upgrade/apply.ts`

## Description

`process.exit(0)` in the try block prevents the finally block from running `isApplying = false` and `clearTimeout`. If the exit somehow fails or is intercepted, the `isApplying` flag stays true permanently. The safety timer race can also trigger after the process has already exited.

## Fix Direction

Move cleanup before `process.exit()`. Use `process.on('exit')` handler for critical cleanup, or restructure so the finally block always runs before exit.
