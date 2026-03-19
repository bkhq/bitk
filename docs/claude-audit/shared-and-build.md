# Shared Package & Build/CI Audit Report

**Date:** 2026-03-19
**Scope:** `packages/shared`, `packages/tsconfig`, root build configuration, CI/CD workflows, compilation and packaging scripts.

---

## Summary

The monorepo is well-structured using Bun Workspaces with clean separation between API, frontend, and shared packages. Build and CI pipelines are solid with SHA-256 checksum verification, proper caching, and concurrency controls. A few areas warrant attention: version catalog is underutilized, some tsconfig inconsistencies exist, and CI could benefit from artifact-based build verification.

---

## 1. Shared Package (`packages/shared/src/index.ts`)

### Strengths
- Clean type-only package with no runtime dependencies -- zero bundle cost.
- Comprehensive type coverage: covers API responses, SSE events, engine types, chat messages, file operations, webhooks, and process management.
- Good use of discriminated unions (`ChatMessage`, `ToolAction`, `LogEntryType`).
- `ApiResponse<T>` envelope type ensures consistent API contract.

### Findings

| # | Severity | Finding |
|---|----------|---------|
| S-1 | LOW | **Runtime values in a types package.** `WEBHOOK_EVENT_GROUPS`, `WEBHOOK_EVENT_TYPES`, and `NOTIFICATION_CHANNELS` are runtime constants exported from what is otherwise a pure type package. This means importing `@bkd/shared` has a non-zero runtime footprint and prevents the package from being `type`-only. Consider splitting runtime constants into a separate module or keeping them colocated with the webhook implementation. |
| S-2 | LOW | **`envVars` typed as `Record<string, string>` on `Project`.** No constraints on key names or value sizes at the type level. The API layer does validate with Zod, but the shared type does not communicate those constraints. |
| S-3 | INFO | **No package.json `exports` field.** `packages/shared/package.json` is not shown but should declare explicit `exports` for clarity with bundlers and TypeScript `moduleResolution: bundler`. |

---

## 2. Root `package.json`

### Strengths
- Proper `"private": true` prevents accidental publishing.
- Clean script naming convention (`dev`, `dev:api`, `dev:frontend`, `test:api`, `test:frontend`).
- `bun --parallel --filter '*' test` runs workspace tests in parallel.
- Dependency catalogs for shared versions (`typescript`, `zod`).

### Findings

| # | Severity | Finding |
|---|----------|---------|
| R-1 | LOW | **Catalog underutilization.** Only `typescript` and `zod` are in the catalog. Other shared deps like `hono`, `drizzle-orm`, or `@types/bun` could benefit from catalog management to prevent version drift across workspaces. |
| R-2 | INFO | **`cleye` is a top-level `dependency`.** This CLI argument parser is only used by `scripts/launcher.ts` for the compiled binary. It could be a `devDependency` since it is bundled into the binary at compile time. |
| R-3 | INFO | **No `engines` field.** The project requires Bun but does not declare a minimum Bun version. Adding `"engines": { "bun": ">=1.x" }` would document the requirement. |

---

## 3. Workspace `package.json` Files

### `apps/api/package.json`

| # | Severity | Finding |
|---|----------|---------|
| A-1 | LOW | **`@types/bun: "latest"` is unpinned.** This can cause non-reproducible builds. Pin to a specific version or use a caret range. |
| A-2 | INFO | **`@libsql/client` in devDependencies.** This appears to be a drizzle-kit requirement only, which is correct placement, but it is an unusual dependency for SQLite via `bun:sqlite`. Confirm it is not accidentally bundled. |

### `apps/frontend/package.json`

| # | Severity | Finding |
|---|----------|---------|
| F-1 | INFO | **`dompurify` is a runtime dependency.** Correctly used -- all `dangerouslySetInnerHTML` usages pass through `DOMPurify.sanitize()`. |
| F-2 | INFO | **`shadcn` in devDependencies.** This is a CLI tool for component generation, correct placement. |
| F-3 | LOW | **`@dnd-kit/react` listed in CLAUDE.md but not in package.json.** The actual DnD library is `@atlaskit/pragmatic-drag-and-drop`. The CLAUDE.md documentation is stale on this point. |

---

## 4. TypeScript Configuration (`packages/tsconfig/`)

### Strengths
- Layered config approach: `base.json` extended by `hono.json`, `react.json`, `utils.json`.
- `strict: true` enabled across all configs.
- `skipLibCheck: true` for build performance.
- React config enables `verbatimModuleSyntax` and `noUnusedLocals`/`noUnusedParameters`.

### Findings

| # | Severity | Finding |
|---|----------|---------|
| T-1 | LOW | **Inconsistent `lib` values.** `base.json` uses `ES2023` (via esnext), `hono.json` uses `ES2022`, `react.json` uses `ES2023`. These should be aligned to the same minimum target. |
| T-2 | LOW | **`base.json` includes `"dom"` in lib.** A base config should not assume DOM availability. The `dom` lib should only be in `react.json` and `hono.json` (for JSX). Backend-only code does not need DOM types. |
| T-3 | INFO | **`noUncheckedIndexedAccess: false` in base.** Enabling this would catch potential `undefined` access on indexed types, improving type safety. |
| T-4 | INFO | **`utils.json` redundantly declares `declaration` and `declarationMap`.** These are already set in `base.json` which it extends. |

---

## 5. ESLint Configuration

### Strengths
- Uses `@antfu/eslint-config` for comprehensive linting with stylistic rules.
- Properly ignores generated directories (`drizzle/`, `components/ui/`).
- Unused import warnings with pattern-based ignore for underscored variables.

### Findings

| # | Severity | Finding |
|---|----------|---------|
| E-1 | MEDIUM | **`react-dom/no-dangerously-set-innerhtml: 'off'`** disables the ESLint guard against XSS. While the codebase currently sanitizes all usages with DOMPurify, turning off this rule means future usages will not be flagged. Recommend keeping the rule as `warn` and using inline `// eslint-disable` on the four sanitized usages. |
| E-2 | LOW | **`ts/no-explicit-any: 'off'`** allows unchecked `any` types throughout. Consider downgrading to `warn` to gradually reduce `any` usage. |
| E-3 | LOW | **`no-console: 'off'`** is appropriate for a server-side app but may lead to console usage in frontend code where `logger` should be preferred. Consider enabling for `apps/frontend/` only. |

---

## 6. Drizzle Configuration (`apps/api/drizzle.config.ts`)

| # | Severity | Finding |
|---|----------|---------|
| D-1 | INFO | **Hardcoded relative DB path `../../data/db/bkd.db`.** This is only used by `drizzle-kit` CLI for migration generation, not at runtime (where `DB_PATH` env var is used). Acceptable but could use the same env var for consistency. |

---

## 7. Vite Configuration (`apps/frontend/vite.config.ts`)

### Strengths
- Custom `shikiSlim()` plugin significantly reduces bundle size by stubbing unused language/theme bundles.
- Well-organized `manualChunks` for optimal code splitting by vendor category.
- Proxy configuration correctly forwards `/api/*` to the backend.

### Findings

| # | Severity | Finding |
|---|----------|---------|
| V-1 | MEDIUM | **`allowedHosts: true`** in dev server config disables host header validation. This makes the dev server vulnerable to DNS rebinding attacks. Use an explicit allowlist or `'auto'` instead. |
| V-2 | LOW | **Dev server binds to `0.0.0.0` by default.** Combined with V-1, this exposes the dev server to the entire network without host validation. |
| V-3 | INFO | **`@dnd-kit/` in manualChunks but not in dependencies.** The chunk splitting references `@dnd-kit/` but the actual dependency is `@atlaskit/pragmatic-drag-and-drop`. Dead chunk config. |

---

## 8. Build Scripts

### `scripts/compile.ts`

**Strengths:**
- Backup/restore mechanism for `static-assets.ts` and `embedded-migrations.ts` prevents corruption from interrupted builds.
- SHA-256 checksum generation for all output artifacts.
- Two-mode compilation (full binary vs. launcher) is well-separated.

| # | Severity | Finding |
|---|----------|---------|
| C-1 | LOW | **Checksums append without deduplication.** If compile runs multiple times, `checksums.txt` accumulates duplicate entries. Should overwrite or deduplicate. |
| C-2 | INFO | **`strict: false` in `parseArgs`.** Unknown CLI flags are silently ignored. Could mask typos. |

### `scripts/package.ts`

**Strengths:**
- Clean staging directory approach with full cleanup on completion.
- Version validation with semver regex.
- SHA-256 checksums for the archive.

| # | Severity | Finding |
|---|----------|---------|
| P-1 | LOW | **Same checksum append issue as C-1.** |
| P-2 | INFO | **Staging directory `.package-staging` should be in `.gitignore`.** Verify it is excluded. |

### `scripts/launcher.ts`

**Strengths:**
- Mandatory SHA-256 checksum verification before installing downloaded packages.
- Allowed-host validation for download URLs (only `github.com` and `objects.githubusercontent.com`).
- Max download size limit (50 MB).
- Path traversal prevention for version directories.
- Atomic extraction via temp directory + rename.
- Post-extraction validation (checks for `server.js`).
- Retry with exponential backoff.
- Semver validation on all version strings.
- Database repair mode with transactional migration application.

| # | Severity | Finding |
|---|----------|---------|
| L-1 | LOW | **`BKD_ROOT` from environment controls root directory.** If an attacker can set this env var, they control where data is read/written. This is acceptable for a CLI tool but should be documented. |
| L-2 | INFO | **No signature verification.** Checksums verify integrity but not authenticity. An attacker who compromises the GitHub release could provide matching checksums. Consider GPG signature verification for higher assurance. |

---

## 9. CI/CD Workflows

### `.github/workflows/ci.yml`

**Strengths:**
- Minimal permissions (`contents: read`).
- Concurrency control with cancel-in-progress.
- Matrix strategy for parallel lint/typecheck/test.
- Dependency caching via `bun.lock` hash.
- 10-minute timeout prevents runaway jobs.

| # | Severity | Finding |
|---|----------|---------|
| CI-1 | LOW | **`fail-fast: true`** means if lint fails, test and typecheck are cancelled. Consider `fail-fast: false` to get complete feedback in one CI run. |
| CI-2 | LOW | **Build job depends on check but does not upload artifacts.** The frontend build output is not preserved for deployment verification. |
| CI-3 | INFO | **No Bun version pinning.** `oven-sh/setup-bun@v2` installs latest Bun. Pin a version for reproducibility. |

### `.github/workflows/release.yml`

**Strengths:**
- Version format validation before release.
- Checksum verification before publishing (`sha256sum -c`).
- Separate `validate`, `package`, and `release` jobs with proper dependencies.
- `contents: write` permission scoped only to the release job.

| # | Severity | Finding |
|---|----------|---------|
| RE-1 | INFO | **`generate_release_notes: true` with `append_body: true`.** This auto-generates notes from commits, which is good. The manual body section is appended cleanly. |

### `.github/workflows/launcher.yml`

**Strengths:**
- Cross-compilation for 4 target platforms.
- Combined checksums file.
- Uses `--latest=false` to prevent launcher releases from becoming the "latest" release.
- Atomic tag update via force-push + release recreation.

| # | Severity | Finding |
|---|----------|---------|
| LA-1 | MEDIUM | **`permissions: contents: write` at workflow level** rather than job level. This is broader than necessary. Scope to the job that needs it. |
| LA-2 | LOW | **`git push origin --force` on the launcher tag.** Force-pushing tags is necessary for the "rolling launcher" pattern but could cause issues if another workflow is triggered by tag events. The `concurrency` group mitigates this. |

---

## Priority-Ranked Issues

| Priority | ID | Summary |
|----------|----|---------|
| MEDIUM | E-1 | `dangerouslySetInnerHTML` ESLint rule disabled globally |
| MEDIUM | V-1 | Dev server `allowedHosts: true` disables host validation |
| MEDIUM | LA-1 | Launcher workflow permissions broader than needed |
| LOW | R-1 | Catalog underutilization risks version drift |
| LOW | T-1 | Inconsistent TypeScript `lib` targets across configs |
| LOW | T-2 | Base tsconfig includes DOM types unnecessarily |
| LOW | A-1 | `@types/bun: "latest"` unpinned |
| LOW | E-2 | `ts/no-explicit-any` fully disabled |
| LOW | V-2 | Dev server binds 0.0.0.0 by default |
| LOW | C-1/P-1 | Checksum files append duplicates on repeated builds |
| LOW | CI-1 | `fail-fast: true` hides parallel failures |
| LOW | CI-3 | No Bun version pinning in CI |
| LOW | F-3 | CLAUDE.md references `@dnd-kit` but actual dep is `@atlaskit` |
| LOW | S-1 | Runtime constants in types-only package |
| INFO | L-2 | No GPG signature verification for launcher downloads |
