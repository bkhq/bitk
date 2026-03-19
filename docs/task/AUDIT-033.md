# AUDIT-033 Launcher release channel is mutable via forced launcher-v1 tag rewrite

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Release
- **created**: 2026-03-19

## Location

- `.github/workflows/launcher.yml:61-69`

## Description

The launcher release workflow force-deletes and force-pushes the fixed tag `launcher-v1` on every run, then recreates the release on top of that moving tag.

This makes the launcher download channel mutable rather than immutable:

- the same tag can point to different commits over time
- existing documentation links always resolve to the latest mutable artifact
- rollback and provenance auditing become harder

## Fix Direction

Publish versioned launcher tags (for example `launcher-v1.2.3` or `launcher-<date>-<sha>`) and keep `launcher-v1` only as an optional convenience pointer, not the sole provenance anchor.
