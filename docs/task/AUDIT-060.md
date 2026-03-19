# AUDIT-060 Floating-point cost accumulation drift

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-engines.md
- **created**: 2026-03-19

## Location

- `apps/api/src/engines/issue/pipeline/token-usage.ts`

## Description

`totalCostUsd` is accumulated via SQL floating-point arithmetic. Over many updates, precision drifts. Though stored as TEXT, the SQL `+` operation uses float internally.

## Fix Direction

Store cost as integer microdollars or use string-based decimal arithmetic to avoid float precision loss.
