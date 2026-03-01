# Changelog

## 2026-03-01 01:10 [progress]
Moved `drizzle/` migrations directory and `drizzle.config.ts` from monorepo root into `apps/api/`, moved `drizzle-kit` dependency to `@bitk/api`, and updated root db scripts to proxy via `bun --filter`. Prevents future conflicts if other workspaces need their own databases.

## 2026-02-28 05:45 [progress]
Initialized PMA project-management files (`docs/task/*`, `docs/plan/*`, format docs, architecture/changelog) and migrated active tasks into PMA task index/detail tracking.

## 2026-02-28 05:47 [decision]
Switched project workflow guidance from `/ptask` to `/pma` in AGENTS/CLAUDE and marked `task.md` as legacy archive for transition compatibility.

## 2026-02-28 05:55 [progress]
Moved legacy archive file from repository root `task.md` to `docs/task.md` and updated active guidance references.

## 2026-02-28 06:03 [progress]
Added `docs/tmp/` to `.gitignore` to keep temporary documentation artifacts out of version control.

## 2026-03-01 00:21 [progress]
Optimized frontend bundle loading by fixing Shiki slim alias compatibility for `langs-bundle-full-*`, deferring terminal drawer/runtime with lazy imports, and lazy-loading heavy diff components. Build verification confirms `cpp-*` and `emacs-lisp-*` chunks are no longer emitted.
