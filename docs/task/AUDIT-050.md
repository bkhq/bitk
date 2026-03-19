# AUDIT-050 Codex sendUserMessage error silently swallowed

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-engines.md
- **created**: 2026-03-19

## Location

- `apps/api/src/engines/executors/codex/executor.ts`

## Description

The protocolHandler.sendUserMessage wrapper uses `void handler.sendUserMessage(content)`, discarding any RPC error. If `turn/start` fails, users see no error feedback and the issue appears stuck with no indication of what went wrong.

## Fix Direction

Await the sendUserMessage call and propagate errors to the issue lifecycle (mark session as failed, emit error event to SSE).
