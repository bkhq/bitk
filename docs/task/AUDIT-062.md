# AUDIT-062 No webhook retry mechanism for failed deliveries

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/webhooks/dispatcher.ts`

## Description

Failed webhook deliveries are logged but never retried. Transient failures (network timeouts, 5xx responses) cause permanent event loss.

## Fix Direction

Add a retry queue with exponential backoff (e.g., 3 retries at 1s, 5s, 30s). Mark delivery as permanently failed after max retries.
