# AUDIT-067 Files and filesystem API lack shared path validation

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: codex-audit/api-data-upgrade.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/files.ts`
- `apps/api/src/routes/filesystem.ts`

## Description

`filesystem.ts` validates paths against the workspace root but `files.ts` does not. The two file-related surfaces do not share a centralized path validation utility, leading to inconsistent security boundaries.

## Fix Direction

Extract a shared `validatePathAccess(root, path)` utility and use it in both route handlers.
