# AUDIT-046 EventBus emit-during-unsubscribe race condition

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/events/event-bus.ts`

## Description

If a subscriber callback triggers an unsubscribe during event emission, `splice` mutates the subscriber array while `for...of` iterates it. This can skip subscribers or cause index errors. The race is intermittent and depends on callback execution order.

## Fix Direction

Copy the subscriber array before iterating (`[...subscribers].forEach(...)`) or use a Set and iterate a snapshot. Alternatively, mark subscribers for removal and clean up after iteration.
