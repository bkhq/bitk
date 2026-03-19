# AUDIT-029 Files API caller-controlled root exposes host filesystem

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/files.ts:54-72`
- `apps/api/src/routes/files.ts:322-334`

## Description

The `/api/files/*` endpoints accept a caller-supplied `root` query parameter and use it as the effective filesystem sandbox root without checking it against the configured workspace, project ownership, or any server-side allowlist.

As a result, any client that can reach the API can browse, download, overwrite, or delete arbitrary paths accessible to the BKD process by choosing values such as `/`, `/etc`, or another project directory.

Affected surfaces:

- `GET /api/files/show`
- `GET /api/files/raw/*`
- `PUT /api/files/save/*`
- `DELETE /api/files/delete/*`

## Fix Direction

Derive the root directory server-side from trusted project/worktree context instead of a raw query parameter, or at minimum validate the requested root against a strict allowlist built from configured workspace/project directories.
