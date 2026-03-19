# AUDIT-044 Files API read operations do not verify symlinks

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **source**: claude-audit/backend-routes.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/files.ts` (handleShow, handleRaw)

## Description

File read operations (`handleShow`, `handleRaw`) check `isInsideRoot` on the logical path but do not call `verifyRealPath` to follow symlinks. A symlink placed within the root directory could let clients read files outside the intended sandbox. Write operations already verify symlinks; read operations do not.

## Fix Direction

Add `verifyRealPath()` / `realpath()` check to all read operations, consistent with write operations.
