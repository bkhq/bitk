# AUDIT-031 Full compile injects mismatched version symbols

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Build
- **created**: 2026-03-19

## Location

- `scripts/compile.ts:230-233`
- `apps/api/src/version.ts:1-3`
- `apps/api/src/globals.d.ts:1-2`

## Description

The full binary compile path defines `__BKD_VERSION__` and `__BKD_COMMIT__`, but the runtime version module reads `__BITK_VERSION__` and `__BITK_COMMIT__`.

This means package-mode builds and full compiled binaries do not share the same injected symbol contract, and the full binary path can silently fall back to `'dev'` metadata even for release builds.

## Fix Direction

Use one canonical symbol pair across `scripts/compile.ts`, `scripts/package.ts`, `apps/api/src/version.ts`, and `apps/api/src/globals.d.ts`, then add a build-time smoke test that asserts the reported version/commit are non-dev in release artifacts.
