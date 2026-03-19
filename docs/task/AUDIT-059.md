# AUDIT-059 No merged prompt size limit for pending inputs

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-engines.md
- **created**: 2026-03-19

## Location

- `apps/api/src/engines/issue/lifecycle/completion-monitor.ts`

## Description

When flushing pending inputs, all queued prompts are joined with newlines without a total size limit. Many queued messages could produce an excessively large combined prompt sent to the AI engine, causing errors or excessive token usage.

## Fix Direction

Cap the combined prompt size. Excess messages should remain queued or be rejected with an error.
