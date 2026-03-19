# AUDIT-064 API client missing AbortSignal propagation

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Frontend
- **source**: claude-audit/frontend-state.md
- **created**: 2026-03-19

## Location

- `apps/frontend/src/lib/kanban-api.ts`

## Description

`kanban-api.ts` does not accept or propagate `AbortSignal`. React Query passes `signal` to `queryFn` but the API client ignores it. This causes race conditions where stale responses overwrite fresh data after component navigation.

## Fix Direction

Add optional `signal?: AbortSignal` parameter to `request()` and pass it to `fetch()`. Update React Query hooks to forward the signal.
