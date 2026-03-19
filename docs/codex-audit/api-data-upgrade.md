# API Data and Upgrade Audit

## Boundary

This module covers:

- `apps/api/src/db/*`
- `apps/api/drizzle/*`
- `apps/api/src/routes/files.ts`
- `apps/api/src/routes/filesystem.ts`
- `apps/api/src/routes/git.ts`
- `apps/api/src/routes/worktrees.ts`
- `apps/api/src/uploads.ts`
- `apps/api/src/upgrade/*`

## Newly Confirmed Findings

### `AUDIT-029` Critical: `/api/files/*` trusts a caller-controlled root

Evidence:

- `apps/api/src/routes/files.ts:54-72`
- `apps/api/src/routes/files.ts:322-334`

Why it matters:

- The API accepts `root` directly from the request and treats it as the sandbox root.
- The same handler family then exposes show, raw download, save, and delete operations.
- There is no server-side binding between `root` and a trusted project/worktree context.

Impact:

- arbitrary host file read
- arbitrary host file overwrite
- arbitrary host file deletion

### `AUDIT-030` High: root containment uses unsafe prefix matching

Evidence:

- `apps/api/src/routes/files.ts:16-19`
- `apps/api/src/routes/files.ts:63-68`

Why it matters:

- `target.startsWith(root + '/')` is not a safe path-boundary test.
- Once absolute or sibling-prefix paths enter the flow, the guard can accept paths outside the intended root.

Impact:

- future root restrictions will still be bypassable if they reuse this helper
- the current unrestricted-root issue becomes easier to exploit in edge cases

### `AUDIT-035` Critical: upgrade restart accepts unverified artifacts

Evidence:

- `apps/api/src/routes/settings/upgrade.ts:85-123`
- `apps/api/src/upgrade/download.ts`
- `apps/api/src/upgrade/apply.ts:95-99`

Why it matters:

- checksum verification is optional during download
- apply/restart accepts both `completed` and `verified`
- binary mode executes the downloaded file directly
- package mode trusts the extracted package once `server.js` exists

Impact:

- a downloaded but unverified artifact can become the active server version
- the upgrade path becomes far more dangerous when combined with weak route exposure

## Existing Backlog Mapped Here

- `AUDIT-001`: upgrade path traversal
- `AUDIT-003`: recycle-bin endpoint exposes deleted issues globally
- `AUDIT-014`: attachment original filename is unsanitized
- `AUDIT-015`: workspace path validation is incomplete
- `AUDIT-017`: migration error matching regex is brittle
- `AUDIT-021`: soft delete does not cascade to logs and attachments
- `AUDIT-024`: worktree cleanup silently truncates

## Audit Notes

- `apps/api/src/routes/filesystem.ts` is stricter than `apps/api/src/routes/files.ts` because it at least checks against the configured workspace root. The two file-related surfaces do not currently share one authoritative path policy.
- `apps/api/src/routes/settings/upgrade.ts:85-123` validates GitHub download hosts, which is good, but upgrade safety still depends on lower-level path handling in `apps/api/src/upgrade/*`.
- Existing tasks `AUDIT-001`, `AUDIT-014`, and `AUDIT-015` combine with `AUDIT-029` and `AUDIT-030` into one recurring theme: path and filename trust is scattered across multiple codepaths instead of being centralized.
- `AUDIT-035` shows the same pattern in the release path: artifact trust is split across route validation, download status, and apply-time checks instead of one mandatory verification gate.

## Recommended Follow-Up

1. Lock down `/api/files/*` immediately.
2. Make artifact verification mandatory before any upgrade activation.
3. Replace all prefix-based path checks with canonicalized path-boundary helpers.
4. Consolidate workspace, upload, worktree, and upgrade path validation into one reusable utility with tests.
