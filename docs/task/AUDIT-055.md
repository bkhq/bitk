# AUDIT-055 Webhook SSRF prevention does not block DNS rebinding

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/backend-routes.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/settings/webhooks.ts`

## Description

`isPrivateHost()` only checks hostnames against a blocklist, not resolved IP addresses. A hostname that resolves to `127.0.0.1` or other private IPs bypasses the private network check, enabling SSRF.

## Fix Direction

Resolve the hostname to IP before checking against private ranges. Use DNS resolution result, not just hostname string matching.
