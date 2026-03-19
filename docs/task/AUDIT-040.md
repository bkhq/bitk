# AUDIT-040 Webhook secrets sent as plaintext Bearer tokens

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/webhooks/dispatcher.ts`

## Description

`deliverWebhook` sends the webhook secret as an `Authorization: Bearer` header. Standard practice is HMAC-SHA256 signing of the payload (e.g., GitHub's `X-Hub-Signature-256`). The current approach exposes the secret in transit and in any HTTP logs, and provides no payload integrity verification.

## Fix Direction

Switch to HMAC-SHA256 signing: compute `HMAC(secret, payload)` and send as `X-Hub-Signature-256` header. Recipients verify the signature instead of comparing Bearer tokens.
