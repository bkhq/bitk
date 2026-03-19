# AUDIT-070 Upload cleanup symlinks could cause out-of-directory deletion

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Security
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/jobs/upload-cleanup.ts`

## Description

Symlinks in the upload directory could cause `unlink` to delete files outside the intended directory. Uses `stat` instead of `lstat`, following symlinks during age check and then deleting the symlink target.

## Fix Direction

Use `lstat` instead of `stat`. Additionally verify the real path is within the upload directory before deleting.
