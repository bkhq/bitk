# AUDIT-042 Upgrade apply exits without verifying child process health

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/upgrade/apply.ts`

## Description

After spawning the new binary/launcher, the old process calls `process.exit(0)` without verifying the child started successfully. A corrupted download (despite checksum passing) or missing runtime dependency causes permanent service outage with no automatic recovery.

## Fix Direction

Wait for the child process to signal readiness (e.g., health check on the new port, or a startup confirmation message on stdout) before exiting. Add a timeout: if the child doesn't become healthy within N seconds, log the failure and abort the upgrade.
