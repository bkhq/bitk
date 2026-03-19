# AUDIT-061 git status expensive in large repos for changes summary

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Performance
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/events/changes-summary.ts`

## Description

`git status --porcelain=v1 -uall` enumerates every file in untracked directories. In large repos with many untracked files (e.g., node_modules not gitignored), this can take minutes. The 10s timeout means no changes summary is emitted, degrading UX.

## Fix Direction

Use `-uno` or `-unormal` instead of `-uall` to avoid deep enumeration of untracked directories.
