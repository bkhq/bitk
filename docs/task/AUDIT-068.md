# AUDIT-068 Compile script mutates tracked source files in place

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Maintainability
- **source**: codex-audit/repo-infra.md
- **created**: 2026-03-19

## Location

- `scripts/compile.ts`

## Description

The full compile script writes generated content into tracked source files and restores them from `.bak` files after build. Concurrent or interrupted builds can contend on the same backup filenames, corrupting source files.

## Fix Direction

Use a temporary directory for generated files and configure the build to reference them, rather than mutating tracked files.
