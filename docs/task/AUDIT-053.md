# AUDIT-053 MCP API key comparison not timing-safe

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/backend-routes.md
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/mcp.ts`

## Description

Bearer token comparison uses `!==` which leaks key length/content via timing side-channel. Should use `crypto.timingSafeEqual()`.

## Fix Direction

Replace string comparison with `crypto.timingSafeEqual()` after ensuring both buffers are the same length.
