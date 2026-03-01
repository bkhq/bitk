# PLAN-002 Frontend bundle-size optimization for Shiki and terminal

- status: completed
- task: ENG-006
- owner: codex
- createdAt: 2026-03-01 00:16 UTC
- updatedAt: 2026-03-01 00:21 UTC

## Context
- `dist/assets` currently includes many unexpectedly large language chunks (e.g. `cpp`, `emacs-lisp`) and a large route chunk (`SubIssueDialog-*`) that contains diff/highlighter runtime.
- Existing Vite `shikiSlim` plugin rewrites `./langs.mjs` and `./themes.mjs`, but current `shiki@4` also references full-bundle language entry paths (`langs-bundle-full-*`), so the rewrite is incomplete.
- `@pierre/diffs` imports `bundledLanguages` from `shiki`, which can trigger full language bundle mapping.
- Main entry includes `TerminalDrawer`, and terminal runtime imports `@xterm/*` statically, increasing `index-*` payload.

## Proposal
- Extend Vite shiki alias/rewrite coverage to intercept full-bundle language entry references used by current Shiki builds.
- Convert terminal drawer/view to lazy-loaded components so xterm code only loads when terminal is opened or terminal page is visited.
- Convert heavy diff/syntax render components to lazy loading boundaries where possible (`DiffPanel` and `SessionMessages`) to defer `@pierre/diffs` and shiki-related code from default route chunks.
- Keep existing behavior and fallback UX intact with lightweight loading placeholders.

## Risks
- Overly aggressive aliasing can break `shiki` runtime resolution if non-target modules are rewritten.
- Lazy loading can introduce loading flashes or hydration timing issues in message/diff views.
- TypeScript/lint errors may occur if lazy component props are not preserved correctly.

## Scope
- `apps/frontend/vite.config.ts` alias logic updates.
- Terminal component import graph updates for lazy loading.
- Issue detail/chat/diff related component import graph updates for lazy loading.
- Build verification and task/plan/changelog synchronization.

## Alternatives
- Replace `@pierre/diffs` with a lighter custom diff renderer.
- Remove Shiki highlighting from diff/chat views and fallback to plain text.
- Keep behavior unchanged and only suppress Vite chunk warnings (does not solve payload size).
