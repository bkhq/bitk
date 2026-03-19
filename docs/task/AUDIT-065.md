# AUDIT-065 Terminal session store resource leak on reset

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Frontend
- **source**: claude-audit/frontend-state.md
- **created**: 2026-03-19

## Location

- `apps/frontend/src/stores/terminal-session-store.ts`

## Description

Calling `reset()` without closing the WebSocket and disposing the Terminal object leaks resources. The store does not enforce cleanup order. Connections and terminal instances accumulate on repeated open/close cycles.

## Fix Direction

Add a `dispose()` method that closes WebSocket and disposes Terminal before resetting state. Call it from drawer close handler.
