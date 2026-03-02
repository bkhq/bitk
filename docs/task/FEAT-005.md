# FEAT-005 Add global web terminal (xterm.js + Bun native PTY)

- status: completed
- priority: P1
- owner: claude
- createdAt: 2026-02-26 21:28 UTC
- updatedAt: 2026-02-28 05:45 UTC

## Summary
Build a global web terminal experience accessible from sidebar entry points, with desktop drawer and mobile route behavior.

## Scope
- Backend terminal session lifecycle endpoints.
- Frontend xterm.js integration and terminal UI state.
- Session reconnect and responsive behavior.

## Acceptance Criteria
- Terminal can be opened globally from app navigation.
- Session input/output works and persists across hide/show.
- Desktop/mobile layouts follow expected behavior.

## Notes
- Original source of truth before migration: `task.md` FEAT-005 entry.
