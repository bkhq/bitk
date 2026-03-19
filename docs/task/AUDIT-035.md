# AUDIT-035 Upgrade restart path accepts downloaded artifacts without mandatory integrity verification

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/settings/upgrade.ts:85-123`
- `apps/api/src/upgrade/download.ts:112-156`
- `apps/api/src/upgrade/apply.ts:95-99`
- `apps/api/src/upgrade/apply.ts:138-170`

## Description

The upgrade download API accepts `checksumUrl` as optional, and the apply/restart path accepts both `completed` and `verified` download states. That means a downloaded artifact can be activated without a successful integrity-verification step.

In binary mode the downloaded file is executed directly. In package mode the tarball is activated as long as the extracted directory contains `server.js`.

## Fix Direction

Make integrity verification mandatory before activation. The restart path should reject any artifact that has not been positively verified against a trusted checksum or signature source.
