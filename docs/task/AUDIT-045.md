# AUDIT-045 No CORS middleware configured

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **source**: claude-audit/security.md
- **created**: 2026-03-19

## Location

- `apps/api/src/app.ts`

## Description

No `hono/cors` middleware is used despite `ALLOWED_ORIGIN` being documented in `.env.example`. Combined with no authentication and binding to `0.0.0.0`, a malicious webpage on any origin can make cross-origin requests to the BKD API for non-preflight (simple) endpoints. This enables CSRF-style attacks from any browser tab.

## Fix Direction

Add `cors()` middleware from `hono/cors` using `ALLOWED_ORIGIN` env var. Default to the server's own origin or `localhost` rather than `*`.
