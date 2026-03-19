# Repository Infrastructure Audit

## Boundary

This module covers:

- root `package.json`
- `scripts/compile.ts`
- `scripts/package.ts`
- `scripts/launcher.ts`
- `.github/workflows/*.yml`
- `packages/shared`
- `packages/tsconfig`

## Newly Confirmed Findings

### `AUDIT-031` Medium: full compile injects the wrong version symbols

Evidence:

- `scripts/compile.ts:230-233`
- `apps/api/src/version.ts:1-3`
- `apps/api/src/globals.d.ts:1-2`

Why it matters:

- package mode uses `__BITK_*`
- full compiled binaries use `__BKD_*`
- runtime version reporting therefore depends on which release path produced the artifact

Impact:

- release binaries can silently report `dev`
- operational debugging and provenance become less trustworthy

### `AUDIT-033` Medium: launcher release channel is mutable

Evidence:

- `.github/workflows/launcher.yml:61-69`

Why it matters:

- the workflow force-deletes and force-pushes `launcher-v1`
- the same public tag can therefore point to different commits over time
- provenance and rollback are weaker than with immutable versioned tags

## Additional Infrastructure Observations

### Full compile mutates source files in place during asset embedding

Evidence:

- `scripts/compile.ts:50-53`
- `scripts/compile.ts:121-131`
- `scripts/compile.ts:163-215`
- `scripts/compile.ts:243-252`

Notes:

- The script writes generated content into tracked source files and restores them from fixed `.bak` filenames.
- It does have stale-backup recovery, but concurrent runs or interrupted builds can still contend on the same backup names.

Assessment:

- This is a build-hygiene and concurrency risk. It is not tracked as a standalone task yet, but it is worth revisiting if build automation becomes more parallel.

### Package mode also uses a shared staging directory

Evidence:

- `scripts/package.ts:39`
- `scripts/package.ts:92-97`
- `scripts/package.ts:175-203`

Notes:

- `.package-staging` is a fixed repository-level path.
- Concurrent package runs can remove each other's staging state.

### CI and release dependencies are not pinned immutably

Evidence:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/launcher.yml`

Notes:

- The workflows use mutable action tags such as `@v2`, `@v5`, and `@v6`.
- Bun setup is also not pinned to a specific runtime version in the workflows.
- This is a reproducibility and supply-chain hardening gap rather than an application bug.

## Shared Contract Notes

- `packages/shared/src/index.ts` is not just a types package. It defines the canonical UI protocol for logs, tool groups, timeline entries, and execution request payloads.
- Any executor or frontend timeline refactor that bypasses these shared contracts increases drift risk immediately.

## Recommended Follow-Up

1. Unify version symbol names across every release path.
2. Stop relying on a single mutable launcher release tag as the only public pointer.
3. Consider generating embedded asset/migration files into a temporary build directory instead of rewriting tracked source files in place.
4. Isolate package staging paths per run and pin CI/release toolchain dependencies more strictly.
