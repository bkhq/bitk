# AUDIT-071 Vite dev server allowedHosts:true disables host validation

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/shared-and-build.md
- **created**: 2026-03-19

## Location

- `apps/frontend/vite.config.ts`

## Description

Dev server config sets `allowedHosts: true`, disabling host header validation. Combined with binding to `0.0.0.0`, this makes the dev server vulnerable to DNS rebinding attacks from the local network.

## Fix Direction

Set `allowedHosts` to `['localhost', '127.0.0.1']` or remove the override to use Vite's default protection.
