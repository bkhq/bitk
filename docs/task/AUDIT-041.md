# AUDIT-041 Telegram bot token exposed in API URL

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/webhooks/dispatcher.ts`

## Description

The Telegram bot token is interpolated directly into the API URL (`https://api.telegram.org/bot{TOKEN}/sendMessage`). If this URL appears in error logs, HTTP debugging output, or exception stack traces, the token is exposed, granting full bot control to anyone who sees it.

## Fix Direction

Avoid logging the full Telegram URL. Mask or redact the token in any log output. Consider moving the token to a header if the Telegram API supports it, or at minimum ensure the URL is never included in error messages.
