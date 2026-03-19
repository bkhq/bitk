# AUDIT-057 UPLOAD_DIR uses process.cwd() instead of ROOT_DIR

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-core.md
- **created**: 2026-03-19

## Location

- `apps/api/src/uploads.ts`

## Description

All other path resolutions use `ROOT_DIR` from `root.ts` but `UPLOAD_DIR` uses `process.cwd()`. If the process is started from a non-standard directory, uploads go to an unexpected location.

## Fix Direction

Use `ROOT_DIR` consistently for `UPLOAD_DIR` derivation.
