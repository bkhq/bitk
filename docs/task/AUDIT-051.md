# AUDIT-051 Upgrade download not cancellable

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/upgrade/download.ts`

## Description

Once an upgrade download starts, there is no mechanism to cancel it. A stuck or slow download permanently blocks future downloads since the `isDownloading` flag remains true. The only recovery is to restart the server.

## Fix Direction

Add an AbortController to the download fetch. Expose a cancel endpoint. Add a timeout (e.g., 10 min) after which the download is automatically aborted and the flag is reset.
