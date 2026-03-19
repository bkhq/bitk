# AUDIT-054 Multipart form data bypasses prompt length validation

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/backend-routes.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/issues/message.ts`

## Description

The multipart parsing path in `parseFollowUpBody` does not enforce prompt length limit (32768) or displayPrompt limit (500) that the Zod JSON path enforces. A client using multipart form data can send arbitrarily large prompts.

## Fix Direction

Apply the same length validation to multipart-parsed fields as to JSON-parsed fields.
