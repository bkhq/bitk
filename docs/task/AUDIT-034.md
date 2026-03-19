# AUDIT-034 Privileged API surfaces rely entirely on upstream auth boundaries

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/app.ts:17-34`
- `apps/api/src/index.ts:77-90`

## Description

The main API surface mounts project management, files, settings, notes, events, terminal, and upgrade functionality without any global in-app authentication or authorization middleware. The server also listens on `0.0.0.0` by default.

Only `/api/mcp` implements its own API key / localhost gate, which makes the absence of equivalent protection on the rest of the privileged surfaces explicit.

## Fix Direction

Enforce authentication and authorization at the application layer for privileged routes, even if a reverse proxy is also used. At minimum, separate low-risk and high-risk route groups and gate the latter behind explicit auth middleware.
