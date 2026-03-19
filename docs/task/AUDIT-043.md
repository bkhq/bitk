# AUDIT-043 Git detect-remote bypasses workspace sandbox

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **source**: claude-audit/backend-routes.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/git.ts`

## Description

`POST /api/git/detect-remote` does not validate the `directory` parameter against the configured workspace root. A client can probe any directory on the filesystem for git remote URLs, leaking information about other repositories on the host.

## Fix Direction

Validate the directory parameter against the workspace root using `resolveWorkingDir()` or equivalent path containment check before executing `git remote`.
